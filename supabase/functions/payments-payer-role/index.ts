// Payments prototype, phase 4: a passenger hands the "pay the taxi" role back ('decline'), or takes
// a role that was handed back ('volunteer'). The row changes happen in
// passenger_decline_payer_role / passenger_volunteer_as_payer (20260926030000_designated_payer.sql);
// this function checks the caller owns the request and sends the notifications.
//
// Deployed with the default JWT verification (any logged-in app user may call this).

import { createClient } from 'npm:@supabase/supabase-js@2';

import { sendPush } from '../_shared/push.ts';
import { paymentsEnabled } from '../_shared/stripe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }
  if (!paymentsEnabled()) {
    return jsonResponse({ error: 'Payments are disabled.' }, 403);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let action = '';
  let requestId = '';
  try {
    const body = await req.json();
    action = typeof body?.action === 'string' ? body.action : '';
    requestId = typeof body?.requestId === 'string' ? body.requestId : '';
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  if ((action !== 'decline' && action !== 'volunteer') || !requestId) {
    return jsonResponse({ error: 'action and requestId are required.' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: request } = await adminClient
    .from('passenger_requests')
    .select('id, user_id, group_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!request || request.user_id !== user.id || !request.group_id) {
    return jsonResponse({ error: 'not_in_group' }, 409);
  }
  const groupId = request.group_id as string;

  const rpc = action === 'decline' ? 'passenger_decline_payer_role' : 'passenger_volunteer_as_payer';
  const { data, error } = await adminClient.rpc(rpc, { p_group_id: groupId, p_request_id: requestId });
  if (error) {
    console.error(`${rpc} failed`, error);
    return jsonResponse({ error: 'Could not update the payer.' }, 500);
  }
  const result = data as { done: boolean; reason?: string };
  if (!result.done) {
    return jsonResponse({ error: result.reason ?? 'not_allowed' }, 409);
  }

  if (action === 'decline') {
    // Offer the role to everyone else in the group who hasn't handed it back already.
    const [{ data: group }, { data: members }] = await Promise.all([
      adminClient.from('taxi_groups').select('payer_declined_request_ids').eq('id', groupId).single(),
      adminClient.from('passenger_requests').select('id, user_id').eq('group_id', groupId),
    ]);
    const declined = new Set<string>(group?.payer_declined_request_ids ?? []);
    for (const member of members ?? []) {
      if (member.id === requestId || declined.has(member.id) || !member.user_id) continue;
      await sendPush(adminClient, { userId: member.user_id, key: 'payerNeeded' });
    }
  }

  return jsonResponse({ done: true });
});
