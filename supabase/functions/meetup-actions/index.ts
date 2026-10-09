// "Find your group": what a member of a confirmed group can do at the meetup that changes the
// group itself.
//   - 'continue_without' { requestId, targetRequestId }: the members who found each other leave
//     behind one who never showed up. Marks that passenger as a no-show, takes them out of the
//     group and recalculates the fare estimate for whoever is left
//     (system_remove_no_show_member - only once the wait is over, and only if two passengers
//     remain; see 20261011000000_group_badge_and_meetup.sql). With payments on, the no-show's
//     reservation is released in full - nothing is charged for a seat they were removed from by
//     other passengers; the admin sees the no-show and decides what follows - and the others'
//     reservations are adjusted to the new shares.
//
// "I've found my group" and "We're in the taxi" need no function: the app calls
// member_confirm_found / member_start_ride directly.
//
// Deployed with the default JWT verification (any logged-in app user may call this); the ride in
// `requestId` must belong to the caller.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { NO_SHOW_WAIT_MINUTES } from '../_shared/constants.ts';
import { syncGroupHolds } from '../_shared/holds.ts';
import { stripeForOffers } from '../_shared/offers.ts';
import { syncGroupPayer } from '../_shared/payer.ts';
import { sendPush } from '../_shared/push.ts';
import { rescoreGroup } from '../_shared/rescoreGroup.ts';

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
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let action = '';
  let requestId = '';
  let targetRequestId = '';
  try {
    const body = await req.json();
    action = typeof body?.action === 'string' ? body.action : '';
    requestId = typeof body?.requestId === 'string' ? body.requestId : '';
    targetRequestId = typeof body?.targetRequestId === 'string' ? body.targetRequestId : '';
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }
  if (action !== 'continue_without' || !requestId || !targetRequestId || requestId === targetRequestId) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData } = await adminClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  const user = userData.user;
  if (!user) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const { data: mine } = await adminClient
    .from('passenger_requests')
    .select('id, user_id, group_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!mine || mine.user_id !== user.id) {
    return jsonResponse({ error: 'not_found' }, 404);
  }
  if (!mine.group_id) {
    return jsonResponse({ error: 'no_group' }, 409);
  }
  const groupId = mine.group_id as string;

  const { data, error } = await adminClient.rpc('system_remove_no_show_member', {
    p_group_id: groupId,
    p_request_id: targetRequestId,
    p_actor_request_id: requestId,
    p_wait_minutes: NO_SHOW_WAIT_MINUTES,
  });
  if (error) {
    console.error('system_remove_no_show_member failed', error);
    return jsonResponse({ error: 'remove_failed' }, 500);
  }
  const result = data as {
    blocked: boolean;
    reason?: string;
    group_found?: boolean;
    group_version?: number;
    removed_user_id?: string | null;
  };
  if (result.blocked) {
    return jsonResponse({ error: result.reason }, 409);
  }

  // The fare estimate for whoever is left - same rescore as any other member leaving a confirmed
  // group.
  if (result.group_version != null) {
    await rescoreGroup(adminClient, groupId, result.group_version, {
      rpc: 'system_apply_confirmed_group_rescore',
      groupStatus: 'confirmed',
    });
  }

  // Payments: release the no-show's reservation, bring the others' in line with their new shares,
  // and make sure the group still has a payer (the no-show may have been it).
  const stripe = stripeForOffers();
  if (stripe) {
    try {
      await syncGroupHolds(adminClient, stripe, groupId);
      await syncGroupPayer(adminClient, groupId, new Date());
    } catch (err) {
      // The 5-minute payments-sync-holds job does the same for every confirmed group.
      console.error('payments sync after a no-show failed', err);
    }
  }

  if (result.removed_user_id) {
    await sendPush(adminClient, { userId: result.removed_user_id, key: 'removedNoShow' });
  }

  return jsonResponse({ ok: true, groupFound: result.group_found === true });
});
