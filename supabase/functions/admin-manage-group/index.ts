// Lets the admin correct a manually (or automatically) created group before it's confirmed:
// remove a member, add one, or dissolve the whole group. Every action is blocked once the group
// is 'confirmed' - see supabase/migrations/20260924070000_admin_group_corrections.sql for the
// three admin_* SQL functions this orchestrates and the audit-trail columns.
//
// Same two-phase shape as edit-passenger-request/cancel-passenger-request: a SQL phase locks
// rows and applies whatever doesn't need a Google Routes call, then (for 'remove') this reuses
// _shared/rescoreGroup.ts verbatim, and (for 'add') this computes the grown group's score itself
// and hands it to a dedicated commit function. 'dissolve' needs no rescoring - nothing survives.
//
// Called with the admin's own JWT (forwarded as Authorization), like edit/cancel-passenger-request
// are called with the passenger's - the SQL functions check auth.jwt()->>'email' for
// authorization and use auth.uid() to tag the admin as the audit-trail actor.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { ADMIN_EMAIL, DETOUR_LIMITS, MAX_BAGS_PER_TAXI, MAX_PASSENGERS_PER_TAXI } from '../_shared/constants.ts';
import { buildGroupTotalsPayload, buildMemberScoresPayload, isGroupStillValid } from '../_shared/groupRebalance.ts';
import { computeGroupScore, PendingPassengerRequest } from '../_shared/matchingEngine.ts';
import { rescoreGroup } from '../_shared/rescoreGroup.ts';

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Body =
  | { action: 'remove'; groupId: string; requestId: string }
  | { action: 'add'; groupId: string; requestId: string; force?: boolean }
  | { action: 'dissolve'; groupId: string };

function isBody(value: unknown): value is Body {
  const b = value as Partial<Body> | null;
  if (!b || typeof b.groupId !== 'string') return false;
  if (b.action === 'dissolve') return true;
  if (b.action === 'remove' || b.action === 'add') return typeof (b as { requestId?: unknown }).requestId === 'string';
  return false;
}

const GROUP_COLUMNS =
  'id, flight_number, arrival_at, destination_address, bags_count, max_wait_minutes, destination_lat, destination_lng';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  if (!isBody(body)) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Runs as the calling admin (Authorization forwarded) so auth.jwt()/auth.uid() inside the SQL
  // functions resolve to them - those functions authorize themselves against the admin email
  // instead of relying on RLS, since they must write rows the admin doesn't own.
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData } = await userClient.auth.getUser();
  if (userData.user?.email !== ADMIN_EMAIL) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  if (body.action === 'dissolve') {
    const { data, error } = await userClient.rpc('admin_dissolve_group', { p_group_id: body.groupId });
    if (error) {
      console.warn('admin_dissolve_group failed', error);
      return jsonResponse({ error: 'dissolve_failed' }, 500);
    }
    const result = data as { blocked: boolean; reason?: string };
    if (result.blocked) {
      return jsonResponse({ error: result.reason }, 409);
    }
    return jsonResponse({ ok: true }, 200);
  }

  if (body.action === 'remove') {
    const { data, error } = await userClient.rpc('admin_begin_remove_group_member', {
      p_group_id: body.groupId,
      p_request_id: body.requestId,
    });
    if (error) {
      console.warn('admin_begin_remove_group_member failed', error);
      return jsonResponse({ error: 'remove_failed' }, 500);
    }

    const result = data as {
      blocked: boolean;
      reason?: string;
      needs_recalc?: boolean;
      group_id?: string;
      group_version?: number;
    };
    if (result.blocked) {
      return jsonResponse({ error: result.reason }, 409);
    }

    if (result.needs_recalc && result.group_id != null && result.group_version != null) {
      await rescoreGroup(adminClient, result.group_id, result.group_version);
    }

    return jsonResponse({ ok: true }, 200);
  }

  // action === 'add'
  const { data: group, error: groupError } = await adminClient
    .from('taxi_groups')
    .select('id, status')
    .eq('id', body.groupId)
    .single();
  if (groupError || !group) {
    return jsonResponse({ error: 'not_found' }, 404);
  }
  if (group.status !== 'unconfirmed') {
    return jsonResponse({ error: 'group_confirmed' }, 409);
  }

  const { data: members, error: membersError } = await adminClient
    .from('passenger_requests')
    .select(GROUP_COLUMNS)
    .eq('group_id', body.groupId);
  if (membersError || !members) {
    return jsonResponse({ error: 'load_failed' }, 500);
  }
  if (members.length >= MAX_PASSENGERS_PER_TAXI) {
    return jsonResponse({ error: 'group_full' }, 409);
  }

  const { data: candidate, error: candidateError } = await adminClient
    .from('passenger_requests')
    .select(`${GROUP_COLUMNS}, status, group_id`)
    .eq('id', body.requestId)
    .single();
  if (candidateError || !candidate) {
    return jsonResponse({ error: 'not_found' }, 404);
  }
  if (candidate.status !== 'pending' || candidate.group_id != null) {
    return jsonResponse({ error: 'request_not_available' }, 409);
  }

  const combined = [...members, candidate] as PendingPassengerRequest[];
  const geocoded = combined.filter(
    (r): r is PendingPassengerRequest & { destination_lat: number; destination_lng: number } =>
      r.destination_lat != null && r.destination_lng != null
  );
  if (geocoded.length !== combined.length) {
    return jsonResponse({ error: 'missing_coordinates' }, 422);
  }

  const suggestion = await computeGroupScore(geocoded);
  if (!suggestion) {
    return jsonResponse({ error: 'route_computation_failed' }, 502);
  }

  const compatible = isGroupStillValid(
    suggestion,
    geocoded.map((r) => ({ id: r.id, bagsCount: r.bags_count, maxWaitMinutes: r.max_wait_minutes })),
    MAX_BAGS_PER_TAXI,
    DETOUR_LIMITS
  );

  if (!compatible && !body.force) {
    return jsonResponse(
      { ok: false, warning: true, reason: 'incompatible', worstIndividualScore: suggestion.worstIndividualScore },
      200
    );
  }

  const { data: applyResult, error: applyError } = await userClient.rpc('admin_commit_add_group_member', {
    p_group_id: body.groupId,
    p_request_id: body.requestId,
    p_member_scores: buildMemberScoresPayload(suggestion),
    p_group_totals: buildGroupTotalsPayload(suggestion),
    p_forced: !compatible,
  });

  if (applyError) {
    console.warn('admin_commit_add_group_member failed', applyError);
    return jsonResponse({ error: 'add_failed' }, 500);
  }

  const result = applyResult as { applied: boolean; reason?: string };
  if (!result.applied) {
    return jsonResponse({ error: result.reason ?? 'stale' }, 409);
  }

  return jsonResponse({ ok: true, forced: !compatible }, 200);
});
