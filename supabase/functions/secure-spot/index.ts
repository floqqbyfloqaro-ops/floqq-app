// "Match found" screen: the passenger taps "Secure my spot" on the group offered to them (an
// unconfirmed taxi group). What that means depends on the payments prototype:
//   - PAYMENTS_ENABLED off: the acceptance is simply recorded.
//   - on, and the ride is too far away for a card hold (holds open HOLD_LEAD_DAYS before the
//     ride): the acceptance is recorded; the reservation is asked for when the window opens, as
//     for any confirmed group.
//   - on, and a hold is possible: the passenger's ride payment row is prepared here (estimated
//     share + platform fee + buffer - the fee is part of the hold, one card transaction) and the
//     app goes on to payments-place-hold with it. The spot counts as secured only once Stripe
//     says the hold is placed (applyHoldState in _shared/holds.ts) - never on the app's word.
// Calling it again is always safe: it never charges anything and never duplicates a row.
//
// Deployed with the default JWT verification (any logged-in app user may call this); the ride
// must belong to the caller.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { estimatedSharesCents, holdAmountCents, holdWindow, PLATFORM_FEE_CENTS, rideDepartureMs } from '../_shared/holdMath.ts';
import { markSpotSecured } from '../_shared/holds.ts';
import { confirmOfferIfComplete, stripeForOffers } from '../_shared/offers.ts';
import { freeCancelUntilMs } from '../_shared/settlementMath.ts';
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

// Rows the passenger can (re)start a hold from; their amount and window are refreshed first.
const RESTARTABLE_STATUSES = ['NOT_STARTED', 'HOLD_FAILED', 'RELEASED'];

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
    .select('id, user_id, group_id, spot_secured_group_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!mine || mine.user_id !== user.id) {
    return jsonResponse({ error: 'Not found.' }, 404);
  }
  if (!mine.group_id) {
    return jsonResponse({ error: 'no_offer' }, 409);
  }

  const { data: group } = await adminClient
    .from('taxi_groups')
    .select('id, status, total_fare')
    .eq('id', mine.group_id)
    .maybeSingle();
  if (!group || group.status === 'dissolved') {
    return jsonResponse({ error: 'no_offer' }, 409);
  }
  if (group.status === 'confirmed') {
    return jsonResponse({ status: 'CONFIRMED' });
  }
  if (mine.spot_secured_group_id === group.id) {
    return jsonResponse({ status: 'SECURED' });
  }

  if (!paymentsEnabled()) {
    await markSpotSecured(adminClient, requestId, group.id);
    await confirmOfferIfComplete(adminClient, null, group.id);
    return jsonResponse({ status: 'SECURED' });
  }

  const { data: members } = await adminClient
    .from('passenger_requests')
    .select('id, distance_km, arrival_at')
    .eq('group_id', group.id);
  if (!members?.length || group.total_fare == null || members.some((m) => m.distance_km == null)) {
    return jsonResponse({ error: 'fare_not_ready' }, 409);
  }

  const now = new Date();
  const rideMs = rideDepartureMs(members.map((m) => m.arrival_at));
  const { opensAt, deadlineAt } = holdWindow(rideMs, now.getTime());

  // Too early for a card hold: accepting is enough for now.
  if (opensAt.getTime() > now.getTime()) {
    await markSpotSecured(adminClient, requestId, group.id);
    await confirmOfferIfComplete(adminClient, stripeForOffers(), group.id);
    return jsonResponse({ status: 'SECURED', holdOpensAt: opensAt.toISOString() });
  }

  const shareCents = estimatedSharesCents(
    members.map((m) => ({ id: m.id, distanceKm: Number(m.distance_km) })),
    Number(group.total_fare)
  ).get(requestId)!;
  const holdCents = holdAmountCents(shareCents);
  const amounts = {
    estimated_share_cents: shareCents,
    hold_amount_cents: holdCents,
    hold_window_opens_at: opensAt.toISOString(),
    hold_deadline_at: deadlineAt.toISOString(),
    free_cancel_until: new Date(freeCancelUntilMs(rideMs)).toISOString(),
  };

  // One row per passenger per group (unique request_id + group_id): a double tap finds the first.
  await adminClient.from('ride_payments').upsert(
    {
      request_id: requestId,
      group_id: group.id,
      user_id: user.id,
      platform_fee_cents: PLATFORM_FEE_CENTS,
      last_status_actor: 'passenger',
      ...amounts,
    },
    { onConflict: 'request_id,group_id', ignoreDuplicates: true }
  );

  const { data: row } = await adminClient
    .from('ride_payments')
    .select('id, payment_status')
    .eq('request_id', requestId)
    .eq('group_id', group.id)
    .maybeSingle();
  if (!row) {
    return jsonResponse({ error: 'payment_not_ready' }, 500);
  }

  if (row.payment_status === 'HOLD_PLACED') {
    // The hold is there but the spot wasn't marked (an interrupted earlier attempt).
    await markSpotSecured(adminClient, requestId, group.id);
    await confirmOfferIfComplete(adminClient, stripeForOffers(), group.id);
    return jsonResponse({ status: 'SECURED' });
  }

  if (RESTARTABLE_STATUSES.includes(row.payment_status)) {
    // The group may have changed since the row was made: hold today's amount, in a fresh window.
    await adminClient
      .from('ride_payments')
      .update({
        ...amounts,
        ...(row.payment_status === 'RELEASED'
          ? { payment_status: 'NOT_STARTED', stripe_payment_intent_id: null, released_at: null, last_status_actor: 'passenger' }
          : {}),
      })
      .eq('id', row.id)
      .eq('payment_status', row.payment_status);
  } else if (row.payment_status !== 'HOLD_PENDING_AUTH') {
    // Captured, refunded, ...: nothing left to reserve for this group.
    return jsonResponse({ error: 'not_holdable', status: row.payment_status }, 409);
  }

  return jsonResponse({ status: 'HOLD_REQUIRED', ridePaymentId: row.id, holdCents });
});
