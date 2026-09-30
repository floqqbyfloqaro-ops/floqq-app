// Payments prototype, phase 6: captures the passengers' shares and reimburses the payer once a
// ride's receipt is ACCEPTED and its dispute window (DISPUTE_WINDOW_HOURS) is over - see
// _shared/settlement.ts and 20260930000000_capture_and_reimburse.sql.
//   - Called every 5 minutes by pg_cron (no body): settles every ride that's due, and retries
//     reimbursements that are still waiting (payout setup not finished, a refused transfer).
//   - Called by the admin with { groupId } to run the same steps for one group right away. It
//     still only charges once that group's dispute window is over.
// Does nothing while PAYMENTS_ENABLED is off. Deployed with --no-verify-jwt: authenticates via
// the cron secret header or the admin's JWT (see _shared/auth.ts), like payments-sync-holds.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17';

import { isAuthorized } from '../_shared/auth.ts';
import { ADMIN_EMAIL } from '../_shared/constants.ts';
import { acquireLock, releaseLock } from '../_shared/matchLock.ts';
import { scheduleSettlement } from '../_shared/receipts.ts';
import { SettleResult, settleGroup } from '../_shared/settlement.ts';
import { createStripeClient, LiveKeyError, paymentsEnabled } from '../_shared/stripe.ts';

const LOCK_ID = 4;

// Receipts accepted longer ago than this are left alone (their holds would have expired anyway).
const SWEEP_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Accepted receipts whose charge time was never set (the write right after recording failed).
async function scheduleMissing(adminClient: SupabaseClient, now: Date): Promise<void> {
  const { data } = await adminClient
    .from('ride_receipts')
    .select('group_id, total_cents')
    .eq('status', 'ACCEPTED')
    .is('settle_after', null)
    .is('settlement_started_at', null)
    .not('group_id', 'is', null);
  for (const receipt of data ?? []) {
    await scheduleSettlement(adminClient, receipt.group_id, { status: 'ACCEPTED', totalCents: receipt.total_cents }, now);
  }
}

// Groups with something left to do: a receipt that's due and not fully captured, or a payer who
// hasn't been sent everything yet.
async function groupsToSettle(adminClient: SupabaseClient, now: Date): Promise<string[]> {
  const groupIds = new Set<string>();

  const { data: due } = await adminClient
    .from('ride_receipts')
    .select('group_id')
    .eq('status', 'ACCEPTED')
    .is('settled_at', null)
    .lte('settle_after', now.toISOString())
    .gt('settle_after', new Date(now.getTime() - SWEEP_LOOKBACK_MS).toISOString())
    .not('group_id', 'is', null);
  (due ?? []).forEach((r) => groupIds.add(r.group_id));

  // Settled, but the payout row was never written (a run stopped in between).
  const { data: settled } = await adminClient
    .from('ride_receipts')
    .select('group_id')
    .not('settled_at', 'is', null)
    .gt('settled_at', new Date(now.getTime() - SWEEP_LOOKBACK_MS).toISOString())
    .not('group_id', 'is', null);
  const settledIds = (settled ?? []).map((r) => r.group_id as string);
  if (settledIds.length) {
    const { data: payouts } = await adminClient.from('ride_payouts').select('group_id, status').in('group_id', settledIds);
    const statusByGroup = new Map((payouts ?? []).map((p) => [p.group_id, p.status]));
    settledIds.filter((id) => statusByGroup.get(id) !== 'SENT').forEach((id) => groupIds.add(id));
  }

  return [...groupIds];
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
    await scheduleMissing(adminClient, now);

    const groupIds = groupId ? [groupId] : await groupsToSettle(adminClient, now);
    const results: SettleResult[] = [];
    for (const id of groupIds) {
      try {
        results.push(await settleGroup(adminClient, stripe, id));
      } catch (err) {
        // One group's problem never holds up the others; the next run tries it again.
        console.error(`settleGroup ${id} failed`, err);
        results.push({ groupId: id, outcome: 'error' });
      }
    }
    return jsonResponse({ results });
  } finally {
    await releaseLock(adminClient, LOCK_ID);
  }
});
