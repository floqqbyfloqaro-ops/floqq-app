// Payments prototype, phase 3: the passenger taps "Reserve" in the app and this places the hold
// (estimated share + platform fee + buffer) on their saved card - manual capture, on-session, so
// the bank can ask for 3D Secure on the spot. If it does, the app gets the PaymentIntent's client
// secret to show the bank's screen; the final state always comes from Stripe (applyHoldState
// here, and the stripe-webhook function), never from the app.
//
// Deployed with the default JWT verification (any logged-in app user may call this); the
// ride payment must belong to the caller.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

import { applyHoldState, cancelHold } from '../_shared/holds.ts';
import { createStripeClient, getPublishableKey, LiveKeyError, paymentsEnabled } from '../_shared/stripe.ts';

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

// Where the bank's 3D Secure page may send the passenger back to: the FLOQQ app, or Expo Go.
const RETURN_URL_PATTERN = /^(floqq|exps?):\/\//;

const RETRYABLE_STATUSES = ['NOT_STARTED', 'HOLD_FAILED', 'HOLD_PENDING_AUTH'];

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

  let stripe: Stripe | null;
  let publishableKey: string | null;
  try {
    stripe = createStripeClient();
    publishableKey = getPublishableKey();
  } catch (err) {
    if (err instanceof LiveKeyError) return jsonResponse({ error: err.message }, 500);
    throw err;
  }
  if (!stripe || !publishableKey) {
    return jsonResponse({ error: 'Payments are not configured.' }, 500);
  }

  let ridePaymentId = '';
  let returnUrl: string | undefined;
  try {
    const body = await req.json();
    ridePaymentId = typeof body?.ridePaymentId === 'string' ? body.ridePaymentId : '';
    returnUrl = typeof body?.returnUrl === 'string' && RETURN_URL_PATTERN.test(body.returnUrl) ? body.returnUrl : undefined;
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  if (!ridePaymentId) {
    return jsonResponse({ error: 'ridePaymentId is required.' }, 400);
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

  const { data: row } = await adminClient
    .from('ride_payments')
    .select(
      'id, request_id, group_id, user_id, hold_amount_cents, payment_status, stripe_payment_intent_id, hold_attempts, hold_window_opens_at, hold_deadline_at'
    )
    .eq('id', ridePaymentId)
    .single();
  if (!row || row.user_id !== user.id) {
    return jsonResponse({ error: 'Not found.' }, 404);
  }

  if (row.payment_status === 'HOLD_PLACED') {
    return jsonResponse({ status: 'HOLD_PLACED' });
  }
  if (!RETRYABLE_STATUSES.includes(row.payment_status)) {
    return jsonResponse({ error: 'not_holdable', status: row.payment_status }, 409);
  }

  // Still a member of that confirmed group?
  const { data: request } = await adminClient.from('passenger_requests').select('group_id').eq('id', row.request_id).single();
  const { data: group } = await adminClient.from('taxi_groups').select('status').eq('id', row.group_id).single();
  if (request?.group_id !== row.group_id || group?.status !== 'confirmed') {
    return jsonResponse({ error: 'not_in_group' }, 409);
  }

  const now = Date.now();
  if (row.hold_window_opens_at && now < new Date(row.hold_window_opens_at).getTime()) {
    return jsonResponse({ error: 'window_not_open', opensAt: row.hold_window_opens_at }, 409);
  }
  if (row.hold_deadline_at && now > new Date(row.hold_deadline_at).getTime()) {
    return jsonResponse({ error: 'deadline_passed' }, 409);
  }

  // A hold waiting for 3D Secure: resume it instead of starting another.
  if (row.payment_status === 'HOLD_PENDING_AUTH' && row.stripe_payment_intent_id) {
    const pending = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id);
    if (pending.status === 'requires_action') {
      return jsonResponse({ status: 'HOLD_PENDING_AUTH', clientSecret: pending.client_secret, publishableKey });
    }
    const { status } = await applyHoldState(adminClient, stripe, pending.id, 'stripe');
    if (status === 'HOLD_PLACED') return jsonResponse({ status });
  }

  const { data: profile } = await adminClient
    .from('user_payment_profiles')
    .select('stripe_customer_id, default_payment_method_id, has_default_payment_method')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile?.stripe_customer_id || !profile.has_default_payment_method || !profile.default_payment_method_id) {
    return jsonResponse({ error: 'no_payment_method' }, 409);
  }

  // Claim the next attempt number - a concurrent double tap loses here instead of holding twice.
  // Clearing the previous PaymentIntent lets a webhook that beats us to saving the new one still
  // match it (by attempt number, see applyHoldState).
  const attempt = row.hold_attempts + 1;
  const { data: claimed } = await adminClient
    .from('ride_payments')
    .update({ hold_attempts: attempt, stripe_payment_intent_id: null })
    .eq('id', row.id)
    .eq('hold_attempts', row.hold_attempts)
    .select('id');
  if (!claimed?.length) {
    return jsonResponse({ error: 'busy' }, 409);
  }

  const previousIntentId = row.stripe_payment_intent_id;
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: row.hold_amount_cents,
        currency: 'eur',
        customer: profile.stripe_customer_id,
        payment_method: profile.default_payment_method_id,
        payment_method_types: ['card'],
        capture_method: 'manual',
        confirm: true,
        // The app completes any 3D Secure step with Stripe's native SDK.
        use_stripe_sdk: true,
        ...(returnUrl ? { return_url: returnUrl } : {}),
        description: 'FLOQQ shared taxi - share reserved',
        metadata: {
          ride_payment_id: row.id,
          attempt: String(attempt),
          group_id: row.group_id,
          request_id: row.request_id,
          user_id: user.id,
        },
      },
      { idempotencyKey: `floqq-hold-${row.id}-${attempt}` }
    );
  } catch (err) {
    // A declined card still creates a PaymentIntent - record it as a failed hold.
    const declined = (err as { raw?: { payment_intent?: Stripe.PaymentIntent } }).raw?.payment_intent;
    if (!declined) {
      console.error('paymentIntents.create failed', err);
      return jsonResponse({ error: 'stripe_error' }, 502);
    }
    intent = declined;
  }

  // Record the new attempt, then release the previous one (its late webhooks no longer match).
  await adminClient
    .from('ride_payments')
    .update({ stripe_payment_intent_id: intent.id })
    .eq('id', row.id)
    .eq('hold_attempts', attempt)
    .is('stripe_payment_intent_id', null);
  if (previousIntentId && previousIntentId !== intent.id) {
    await cancelHold(stripe, previousIntentId).catch((err) => console.warn('cancel previous hold failed', err));
  }

  const { status } = await applyHoldState(adminClient, stripe, intent.id, 'passenger');

  if (status === 'HOLD_PENDING_AUTH') {
    return jsonResponse({ status, clientSecret: intent.client_secret, publishableKey });
  }
  if (status === 'HOLD_FAILED') {
    const lastError = intent.last_payment_error;
    return jsonResponse({ status, reason: lastError?.decline_code ?? lastError?.code ?? 'payment_failed' });
  }
  return jsonResponse({ status });
});
