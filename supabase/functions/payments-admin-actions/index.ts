// Payments prototype, phase 7: what the admin can do about a payment that went wrong (see
// 20261001000000_payment_failure_handling.sql).
//   - 'recharge' { ridePaymentId }: charges a passenger's outstanding amount (a hold that couldn't be
//     captured) to their saved card, off-session. The payer was already paid by FLOQQ, so this
//     money stays with FLOQQ. Declines and bank verification come back as the error.
//   - 'write_off' { ridePaymentId, note }: closes an outstanding amount without charging it.
//   - 'approve_payout' { groupId }: releases a payer's payout that came from an ESTIMATED receipt
//     (the payer never photographed one) and sends it right away.
//
// Deployed with the default JWT verification; the caller must be the admin account.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

import { ADMIN_EMAIL } from '../_shared/constants.ts';
import { settleGroup } from '../_shared/settlement.ts';
import { createStripeClient, LiveKeyError, paymentsEnabled } from '../_shared/stripe.ts';

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

type Action = 'recharge' | 'write_off' | 'approve_payout';

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

  let action: Action | null = null;
  let ridePaymentId = '';
  let groupId = '';
  let note: string | null = null;
  try {
    const body = await req.json();
    action = ['recharge', 'write_off', 'approve_payout'].includes(body?.action) ? body.action : null;
    ridePaymentId = typeof body?.ridePaymentId === 'string' ? body.ridePaymentId : '';
    groupId = typeof body?.groupId === 'string' ? body.groupId : '';
    note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  if (!action || (action === 'approve_payout' ? !groupId : !ridePaymentId)) {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData } = await adminClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  const admin = userData.user;
  if (!admin || admin.email !== ADMIN_EMAIL) {
    return jsonResponse({ error: 'Forbidden' }, 403);
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

  if (action === 'approve_payout') {
    const { data: approved } = await adminClient
      .from('ride_payouts')
      .update({ approved_at: new Date().toISOString(), approved_by: admin.id, status: 'PENDING' })
      .eq('group_id', groupId)
      .eq('status', 'HELD_FOR_REVIEW')
      .select('id');
    if (!approved?.length) return jsonResponse({ error: 'not_held' }, 409);
    const result = await settleGroup(adminClient, stripe, groupId);
    return jsonResponse({ ok: true, outcome: result.outcome });
  }

  const { data: row } = await adminClient
    .from('ride_payments')
    .select('id, user_id, hold_amount_cents, outstanding_cents, outstanding_resolved_at, recharge_attempts')
    .eq('id', ridePaymentId)
    .maybeSingle();
  if (!row || !row.outstanding_cents || row.outstanding_resolved_at) {
    return jsonResponse({ error: 'nothing_outstanding' }, 409);
  }

  if (action === 'write_off') {
    await adminClient
      .from('ride_payments')
      .update({
        outstanding_resolved_at: new Date().toISOString(),
        outstanding_resolution: 'written_off',
        outstanding_note: note,
      })
      .eq('id', row.id)
      .is('outstanding_resolved_at', null);
    return jsonResponse({ ok: true });
  }

  const { data: profile } = await adminClient
    .from('user_payment_profiles')
    .select('stripe_customer_id, default_payment_method_id')
    .eq('user_id', row.user_id)
    .maybeSingle();
  if (!profile?.stripe_customer_id || !profile.default_payment_method_id) {
    return jsonResponse({ error: 'no_payment_method' }, 409);
  }

  // One number per attempt: Stripe replays a declined request for the same idempotency key.
  const attempt = row.recharge_attempts + 1;
  const { data: claimed } = await adminClient
    .from('ride_payments')
    .update({ recharge_attempts: attempt })
    .eq('id', row.id)
    .eq('recharge_attempts', row.recharge_attempts)
    .select('id');
  if (!claimed?.length) return jsonResponse({ error: 'busy' }, 409);

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: row.outstanding_cents,
        currency: 'eur',
        customer: profile.stripe_customer_id,
        payment_method: profile.default_payment_method_id,
        payment_method_types: ['card'],
        off_session: true,
        confirm: true,
        description: 'FLOQQ shared taxi - outstanding share',
        // Deliberately no ride_payment_id: the webhook's hold bookkeeping must leave this one alone.
        metadata: { floqq_recharge_for: row.id, attempt: String(attempt) },
      },
      { idempotencyKey: `floqq-recharge-${row.id}-${attempt}` }
    );
  } catch (err) {
    const stripeError = err as { code?: string; decline_code?: string };
    console.warn('recharge failed', err);
    await adminClient
      .from('ride_payments')
      .update({ outstanding_note: `recharge ${attempt}: ${stripeError.decline_code ?? stripeError.code ?? 'failed'}` })
      .eq('id', row.id);
    return jsonResponse({ error: stripeError.decline_code ?? stripeError.code ?? 'recharge_failed' }, 402);
  }

  if (intent.status !== 'succeeded') {
    return jsonResponse({ error: intent.status }, 402);
  }

  const now = new Date().toISOString();
  await adminClient
    .from('ride_payments')
    .update({
      payment_status: 'CAPTURED',
      captured_at: now,
      captured_cents: row.outstanding_cents,
      released_cents: Math.max(0, row.hold_amount_cents - row.outstanding_cents),
      recharge_payment_intent_id: intent.id,
      outstanding_resolved_at: now,
      outstanding_resolution: 'recharged',
      outstanding_note: note,
      last_status_actor: 'admin',
    })
    .eq('id', row.id);
  return jsonResponse({ ok: true });
});
