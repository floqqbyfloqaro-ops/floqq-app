// "Match found" screen: the passenger taps "Not for me" on the group offered to them. They leave
// the group and their ride goes back to searching; the group is rescored for whoever is left (or
// dissolved), a hold they had placed is released without any charge, and the matching job won't
// offer them the same passengers again (match_declines). If everyone left in the group has
// already secured their spot, the group confirms itself.
//
// Deployed with the default JWT verification (any logged-in app user may call this); the ride
// must belong to the caller.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { confirmOfferIfComplete, removeFromOffer, stripeForOffers } from '../_shared/offers.ts';

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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let requestId = '';
  try {
    const body = await req.json();
    requestId = typeof body?.requestId === 'string' ? body.requestId : '';
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  if (!requestId) {
    return jsonResponse({ error: 'requestId is required.' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData } = await adminClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  const user = userData.user;
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { data: mine } = await adminClient
    .from('passenger_requests')
    .select('id, user_id, group_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!mine || mine.user_id !== user.id) {
    return jsonResponse({ error: 'Not found.' }, 404);
  }
  if (!mine.group_id) {
    // Already out of the group (a second tap, or the offer ended meanwhile): nothing left to do.
    return jsonResponse({ ok: true });
  }
  const groupId = mine.group_id as string;

  const { data: others } = await adminClient
    .from('passenger_requests')
    .select('id')
    .eq('group_id', groupId)
    .neq('id', requestId);

  const stripe = stripeForOffers();
  const { removed } = await removeFromOffer(adminClient, stripe, groupId, requestId, 'match_declined');
  if (!removed) {
    // The group was confirmed in the meantime: leaving it is a cancellation, with its own rules.
    return jsonResponse({ error: 'not_offered' }, 409);
  }

  const pairs = (others ?? []).flatMap((other) => [
    { request_id: requestId, declined_request_id: other.id },
    { request_id: other.id, declined_request_id: requestId },
  ]);
  if (pairs.length) {
    await adminClient.from('match_declines').upsert(pairs, { onConflict: 'request_id,declined_request_id', ignoreDuplicates: true });
  }

  await confirmOfferIfComplete(adminClient, stripe, groupId);

  return jsonResponse({ ok: true });
});
