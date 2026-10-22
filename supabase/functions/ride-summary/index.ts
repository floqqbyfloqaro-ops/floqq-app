// "Ride completed": the facts behind one passenger's ride summary - only their own figures. The
// receipt total is read here because only the payer may read the receipt itself; each passenger
// gets the total and their own share, never the photo or another passenger's payment. Which
// lines read "Paid", "Pending" or "Est." is decided in the app (src/services/rideSummaryRules.ts)
// from these facts, so it never says "Paid" for anything that wasn't charged.
//
// Deployed with the default JWT verification (any logged-in app user may call this); the ride
// must belong to the caller.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { estimatedSharesCents, PLATFORM_FEE_CENTS } from '../_shared/holdMath.ts';
import { paymentsEnabled } from '../_shared/stripe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);

  let requestId = '';
  try {
    const body = await req.json();
    requestId = typeof body?.requestId === 'string' ? body.requestId : '';
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  if (!requestId) return jsonResponse({ error: 'requestId is required.' }, 400);

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: userData } = await adminClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  const user = userData.user;
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { data: mine } = await adminClient
    .from('passenger_requests')
    .select('id, user_id, group_id, completed_at, completed_source, completion_seen_at, service_fee_status, destination_address, arrival_at')
    .eq('id', requestId)
    .maybeSingle();
  if (!mine || mine.user_id !== user.id) return jsonResponse({ error: 'Not found.' }, 404);
  if (!mine.group_id) return jsonResponse({ summary: null, reason: 'no_group' });

  const { data: group } = await adminClient
    .from('taxi_groups')
    .select('id, status, total_fare, payer_request_id, ride_started_at, completed_at')
    .eq('id', mine.group_id)
    .maybeSingle();
  if (!group || group.status !== 'confirmed') return jsonResponse({ summary: null, reason: 'not_confirmed' });

  // The estimate, from the same fare split as the "Match found" screen.
  const { data: members } = await adminClient
    .from('passenger_requests')
    .select('id, distance_km')
    .eq('group_id', group.id)
    .eq('status', 'matched');
  const memberRows = members ?? [];
  const hasFare = group.total_fare != null && memberRows.length > 0 && memberRows.every((m) => m.distance_km != null);
  const estimatedTotalCents = group.total_fare != null ? Math.round(Number(group.total_fare) * 100) : null;
  const estimatedShareCents = hasFare
    ? (estimatedSharesCents(
        memberRows.map((m) => ({ id: m.id, distanceKm: Number(m.distance_km) })),
        Number(group.total_fare)
      ).get(requestId) ?? null)
    : null;

  const isPayer = group.payer_request_id === requestId;

  // The receipt, as far as this passenger may know it: the total (and, for the payer, what comes
  // back to them). A rejected receipt counts as none.
  const { data: receipt } = await adminClient
    .from('ride_receipts')
    .select('status, total_cents, payer_share_cents, reimbursement_cents')
    .eq('group_id', group.id)
    .maybeSingle();
  const validReceipt = receipt && receipt.status !== 'REJECTED' ? receipt : null;

  // What FLOQQ actually did with this passenger's card (payments on).
  const { data: payment } = await adminClient
    .from('ride_payments')
    .select('payment_status, platform_fee_cents, final_share_cents, captured_cents, captured_at')
    .eq('request_id', requestId)
    .maybeSingle();

  const { data: payout } = isPayer
    ? await adminClient.from('ride_payouts').select('amount_cents, status').eq('group_id', group.id).maybeSingle()
    : { data: null };

  const { data: rating } = await adminClient
    .from('ride_ratings')
    .select('stars, reasons, comment')
    .eq('request_id', requestId)
    .maybeSingle();

  return jsonResponse({
    summary: {
      requestId,
      groupId: group.id,
      destinationAddress: mine.destination_address,
      arrivalAt: mine.arrival_at,
      rideStartedAt: group.ride_started_at,
      completedAt: mine.completed_at,
      completedSource: mine.completed_source,
      completionSeenAt: mine.completion_seen_at,
      groupCompletedAt: group.completed_at,
      paymentsEnabled: paymentsEnabled(),
      isPayer,
      platformFeeCents: payment?.platform_fee_cents ?? PLATFORM_FEE_CENTS,
      estimatedTotalCents,
      estimatedShareCents,
      // 'ACCEPTED' | 'NEEDS_REVIEW' | 'ESTIMATED' (no receipt came, the estimate was used).
      receipt: validReceipt
        ? {
            status: validReceipt.status,
            totalCents: validReceipt.total_cents,
            payerShareCents: isPayer ? validReceipt.payer_share_cents : null,
            reimbursementCents: isPayer ? validReceipt.reimbursement_cents : null,
          }
        : null,
      payment: payment
        ? {
            status: payment.payment_status,
            finalShareCents: payment.final_share_cents,
            capturedCents: payment.captured_cents,
            capturedAt: payment.captured_at,
          }
        : null,
      // Payments off: the separate FLOQQ fee payment ('unpaid' | 'pending' | 'paid').
      serviceFeeStatus: mine.service_fee_status,
      payout: payout ? { amountCents: payout.amount_cents, status: payout.status } : null,
      rating: rating ? { stars: rating.stars, reasons: rating.reasons, comment: rating.comment } : null,
    },
  });
});
