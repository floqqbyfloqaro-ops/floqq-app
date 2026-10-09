// Handles editing an existing passenger request. Replaces a plain client-side UPDATE because
// editing a ride that belongs to an unconfirmed group has to atomically remove the editor from
// that group and rebalance (or dissolve) it for whoever is left - see
// supabase/migrations/20260923010000_group_rebalance_on_edit.sql for the two SQL functions this
// orchestrates, and _shared/groupRebalance.ts for the pure validity/payload logic.
//
// Two phases because a plain Postgres transaction can't make the Google Routes HTTP call a
// rescore needs:
//   A. begin_passenger_request_edit (SQL, one transaction) - locks the request + group rows,
//      applies the edit, detaches the editor, and either dissolves the group outright (fully
//      atomic, no external call needed) or hands back the remaining member IDs + group version.
//   B. (here) recompute the surviving group's score via the same computeGroupScore used to form
//      groups in the first place.
//   C. apply_group_rescore (SQL, one transaction) - re-locks the group row, checks the version
//      handed out by phase A still matches (rejecting a stale write if a second concurrent edit
//      on the same group already moved it on), and writes the new scores or dissolves.
//
// Called with the passenger's own JWT (not the admin-only pattern match-and-group uses) - any
// authenticated passenger can edit their own request.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { rescoreGroup } from '../_shared/rescoreGroup.ts';

type EditBody = {
  requestId: string;
  flightNumber: string;
  arrivalAt: string;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  largeLuggageCount: number;
  handLuggageCount: number;
  maxWaitMinutes: number;
  // Omitted when the passenger didn't touch the arrival time (it stayed pinned to the stored
  // flight estimate), so the stored source is kept as-is.
  arrivalTimeSource?: 'flight' | 'manual';
  // The ride's terminal as the form has it now: from the flight lookup, or chosen by the passenger.
  arrivalTerminal: 'T1' | 'T2';
  arrivalTerminalSource: 'flight' | 'passenger';
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function isEditBody(value: unknown): value is EditBody {
  const b = value as Partial<EditBody> | null;
  return (
    !!b &&
    typeof b.requestId === 'string' &&
    typeof b.flightNumber === 'string' &&
    typeof b.arrivalAt === 'string' &&
    typeof b.destinationAddress === 'string' &&
    typeof b.destinationLat === 'number' &&
    typeof b.destinationLng === 'number' &&
    typeof b.largeLuggageCount === 'number' &&
    typeof b.handLuggageCount === 'number' &&
    typeof b.maxWaitMinutes === 'number' &&
    (b.arrivalTimeSource === undefined || b.arrivalTimeSource === 'flight' || b.arrivalTimeSource === 'manual') &&
    (b.arrivalTerminal === 'T1' || b.arrivalTerminal === 'T2') &&
    (b.arrivalTerminalSource === 'flight' || b.arrivalTerminalSource === 'passenger')
  );
}

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

  if (!isEditBody(body)) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Runs as the calling passenger (Authorization forwarded) so auth.uid() inside
  // begin_passenger_request_edit resolves to them - the function relies on that to authorize
  // itself instead of RLS, since it must write rows the caller doesn't own.
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await userClient.rpc('begin_passenger_request_edit', {
    p_request_id: body.requestId,
    p_flight_number: body.flightNumber,
    p_arrival_at: body.arrivalAt,
    p_destination_address: body.destinationAddress,
    p_destination_lat: body.destinationLat,
    p_destination_lng: body.destinationLng,
    p_large_luggage_count: body.largeLuggageCount,
    p_hand_luggage_count: body.handLuggageCount,
    p_max_wait_minutes: body.maxWaitMinutes,
  });

  if (error) {
    console.warn('begin_passenger_request_edit failed', error);
    return jsonResponse({ error: 'update_failed' }, 500);
  }

  const result = data as { blocked: boolean; needs_recalc?: boolean; group_id?: string; group_version?: number };

  if (result.blocked) {
    return jsonResponse({ error: 'group_confirmed' }, 409);
  }

  // Written separately rather than widening begin_passenger_request_edit's signature: where the
  // arrival time came from (display-only, for the admin dashboard) and the ride's terminal. The RPC
  // above already authorized the caller against this row and took the ride out of any group, so
  // the terminal is free to change - the next match is made at the new one.
  const { error: detailsError } = await adminClient
    .from('passenger_requests')
    .update({
      ...(body.arrivalTimeSource ? { arrival_time_source: body.arrivalTimeSource } : {}),
      arrival_terminal: body.arrivalTerminal,
      arrival_terminal_source: body.arrivalTerminalSource,
    })
    .eq('id', body.requestId);
  if (detailsError) {
    console.warn('arrival source/terminal update failed', detailsError);
    return jsonResponse({ error: 'update_failed' }, 500);
  }

  if (result.needs_recalc && result.group_id != null && result.group_version != null) {
    await rescoreGroup(adminClient, result.group_id, result.group_version);
  }

  return jsonResponse({ ok: true }, 200);
});
