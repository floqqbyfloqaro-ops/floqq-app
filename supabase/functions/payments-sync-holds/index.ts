// Payments prototype, phase 3: keeps card holds in step with confirmed groups.
//   - Called by the admin app right after confirming a group ({ groupId }), to create that
//     group's ride_payments rows (estimated share + fee + buffer, hold window) immediately.
//   - Called every 5 minutes by pg_cron (no body): removes passengers whose hold deadline passed
//     without a placed hold (system_remove_unpaid_member + confirmed-group rescore), then re-syncs
//     every recent confirmed group, which also creates any rows the admin call missed and releases
//     holds of dissolved groups.
//   Both also send the push notifications that are due (reserve your seat / reminder / removed /
//   group dissolved - see _shared/holds.ts and _shared/push.ts).
// Does nothing while PAYMENTS_ENABLED is off. Deployed with --no-verify-jwt: authenticates via
// the cron secret header or the admin's JWT (see _shared/auth.ts), like match-and-group.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17';

import { isAuthorized } from '../_shared/auth.ts';
import { ADMIN_EMAIL } from '../_shared/constants.ts';
import {
  cancelHold,
  markNotified,
  RIDE_PAYMENT_COLUMNS,
  RidePaymentRow,
  sendDueHoldNotifications,
  syncGroupHolds,
} from '../_shared/holds.ts';
import { acquireLock, releaseLock } from '../_shared/matchLock.ts';
import { sendPush } from '../_shared/push.ts';
import { rescoreGroup } from '../_shared/rescoreGroup.ts';
import { createStripeClient, LiveKeyError, paymentsEnabled } from '../_shared/stripe.ts';

const LOCK_ID = 3;

// Confirmed groups whose ride was more than this long ago are left alone by the sweep.
const SWEEP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Removes every passenger whose hold deadline passed without a placed hold, then rescores (or
// dissolves) what's left of their group. Returns the affected group ids.
async function removeMissedDeadlines(adminClient: SupabaseClient, stripe: Stripe, now: Date): Promise<Set<string>> {
  const affectedGroups = new Set<string>();

  const { data, error } = await adminClient
    .from('ride_payments')
    .select(RIDE_PAYMENT_COLUMNS)
    .in('payment_status', ['NOT_STARTED', 'HOLD_PENDING_AUTH', 'HOLD_FAILED'])
    .lt('hold_deadline_at', now.toISOString())
    .gt('hold_deadline_at', new Date(now.getTime() - SWEEP_LOOKBACK_MS).toISOString());
  if (error || !data) return affectedGroups;

  for (const row of data as RidePaymentRow[]) {
    if (!row.group_id || !row.request_id) continue;

    // Only act if they're still in that confirmed group (not already removed or regrouped).
    const { data: request } = await adminClient
      .from('passenger_requests')
      .select('group_id')
      .eq('id', row.request_id)
      .single();
    if (request?.group_id !== row.group_id) continue;

    if (row.payment_status === 'HOLD_PENDING_AUTH' && row.stripe_payment_intent_id) {
      await cancelHold(stripe, row.stripe_payment_intent_id);
    }
    await adminClient
      .from('ride_payments')
      .update({ payment_status: 'HOLD_FAILED', failure_reason: 'deadline_passed', last_status_actor: 'system' })
      .eq('id', row.id)
      .eq('payment_status', row.payment_status);

    const { data: removal, error: removalError } = await adminClient.rpc('system_remove_unpaid_member', {
      p_group_id: row.group_id,
      p_request_id: row.request_id,
    });
    if (removalError) {
      console.error('system_remove_unpaid_member failed', removalError);
      continue;
    }

    const result = removal as { blocked: boolean; needs_recalc?: boolean; group_version?: number };
    if (!result.blocked && row.user_id && (await markNotified(adminClient, row.id, 'ended_notified_at'))) {
      await sendPush(adminClient, { userId: row.user_id, key: 'removedDeadline' });
    }
    if (!result.blocked && result.needs_recalc && result.group_version != null) {
      await rescoreGroup(adminClient, row.group_id, result.group_version, {
        rpc: 'system_apply_confirmed_group_rescore',
        groupStatus: 'confirmed',
      });
    }
    affectedGroups.add(row.group_id);
  }

  return affectedGroups;
}

// Groups the sweep should re-sync: confirmed groups with a recent or upcoming ride, plus any
// group that still has an open hold (so a dissolved group's holds get released).
async function groupsToSweep(adminClient: SupabaseClient, now: Date): Promise<Set<string>> {
  const groupIds = new Set<string>();

  const { data: recentRequests } = await adminClient
    .from('passenger_requests')
    .select('group_id')
    .not('group_id', 'is', null)
    .gt('arrival_at', new Date(now.getTime() - SWEEP_LOOKBACK_MS).toISOString());
  const candidateIds = [...new Set((recentRequests ?? []).map((r) => r.group_id as string))];

  if (candidateIds.length > 0) {
    const { data: confirmedGroups } = await adminClient
      .from('taxi_groups')
      .select('id')
      .in('id', candidateIds)
      .eq('status', 'confirmed');
    (confirmedGroups ?? []).forEach((g) => groupIds.add(g.id));
  }

  const { data: openHolds } = await adminClient
    .from('ride_payments')
    .select('group_id')
    .in('payment_status', ['HOLD_PENDING_AUTH', 'HOLD_PLACED'])
    .not('group_id', 'is', null);
  (openHolds ?? []).forEach((r) => groupIds.add(r.group_id as string));

  return groupIds;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  if (!(await isAuthorized(req, adminClient, ADMIN_EMAIL))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  if (!paymentsEnabled()) {
    return jsonResponse({ skipped: 'payments_disabled' });
  }

  let stripe: Stripe | null;
  try {
    stripe = createStripeClient();
  } catch (err) {
    if (err instanceof LiveKeyError) return jsonResponse({ error: err.message }, 500);
    throw err;
  }
  if (!stripe) {
    return jsonResponse({ error: 'Payments are not configured.' }, 500);
  }

  let groupId: string | null = null;
  try {
    const body = await req.json();
    groupId = typeof body?.groupId === 'string' ? body.groupId : null;
  } catch {
    // Cron calls send an empty object; a missing body is fine too.
  }

  if (!(await acquireLock(adminClient, LOCK_ID))) {
    return jsonResponse({ skipped: 'already_running' });
  }

  try {
    const now = new Date();

    if (groupId) {
      const result = await syncGroupHolds(adminClient, stripe, groupId, now);
      await sendDueHoldNotifications(adminClient, now, groupId);
      return jsonResponse({ results: [result] });
    }

    const removedFrom = await removeMissedDeadlines(adminClient, stripe, now);
    const groupIds = await groupsToSweep(adminClient, now);
    removedFrom.forEach((id) => groupIds.add(id));

    const results = [];
    for (const id of groupIds) {
      results.push(await syncGroupHolds(adminClient, stripe, id, now));
    }
    await sendDueHoldNotifications(adminClient, now);
    return jsonResponse({ removedFrom: [...removedFrom], results });
  } finally {
    await releaseLock(adminClient, LOCK_ID);
  }
});
