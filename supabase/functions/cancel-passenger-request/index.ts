// Handles a passenger cancelling their own ride. Replaces the plain client-side
// `status = 'cancelled'` UPDATE, which left a grouped ride attached to its unconfirmed group as a
// ghost member with a stale score/fare split for everyone else.
//
// Same A/B/C shape as edit-passenger-request:
//   A. begin_passenger_request_cancel (SQL, one transaction) - locks the request + group rows,
//      cancels the ride, detaches it, and either dissolves the group outright or hands back the
//      group id + version (20260924050000_one_active_ride_and_group_aware_cancel.sql).
//   B + C. rescoreGroup (_shared/rescoreGroup.ts) - Google Routes rescore of the surviving group,
//      then apply_group_rescore.
//
// Called with the passenger's own JWT, like edit-passenger-request.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { rescoreGroup } from '../_shared/rescoreGroup.ts';

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let body: { requestId?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  if (typeof body?.requestId !== 'string') {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Runs as the calling passenger so auth.uid() inside begin_passenger_request_cancel resolves
  // to them - it authorizes itself against that rather than relying on RLS.
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await userClient.rpc('begin_passenger_request_cancel', {
    p_request_id: body.requestId,
  });

  if (error) {
    console.warn('begin_passenger_request_cancel failed', error);
    return jsonResponse({ error: 'cancel_failed' }, 500);
  }

  const result = data as {
    blocked: boolean;
    reason?: 'group_confirmed' | 'not_active';
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
});
