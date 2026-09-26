// Receives Stripe's events and is the only place that turns them into database state:
//   - Checkout events for the FLOQQ service fee (see create-service-fee-checkout) mark the
//     corresponding passenger_requests row paid.
//   - setup_intent.succeeded (see payments-setup-card) records the passenger's saved card.
//   - payment_intent.* events for ride holds (see payments-place-hold) update ride_payments.
// Stripe calls this directly with no Supabase session, so it must be deployed with
// --no-verify-jwt and does its own auth via the Stripe signature instead (mirrors match-and-group,
// which is unauthenticated-by-Supabase-JWT for the same reason: a cron job calls that one).
//
// Stripe may deliver an event more than once or out of order. Every handler is safe to re-run,
// and each processed event id is recorded in stripe_webhook_events so a repeat is skipped.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

import { applyHoldState } from '../_shared/holds.ts';
import { createStripeClient, LiveKeyError } from '../_shared/stripe.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Makes the most recently saved card the customer's default. Picks the newest succeeded
// SetupIntent from Stripe rather than trusting this event's own payment method, so two card saves
// whose webhooks arrive in the wrong order still end on the card that was saved last. Replaced
// cards stay attached in Stripe (only the default changes), so a hold already placed on the old
// card can still be captured.
async function recordSavedCard(stripe: Stripe, adminClient: SupabaseClient, setupIntent: Stripe.SetupIntent) {
  const customerId = typeof setupIntent.customer === 'string' ? setupIntent.customer : setupIntent.customer?.id;
  if (!customerId) return;

  const intents = await stripe.setupIntents.list({ customer: customerId, limit: 20 });
  const newest = intents.data
    .filter((intent) => intent.status === 'succeeded' && intent.payment_method)
    .sort((a, b) => b.created - a.created)[0];
  if (!newest) return;

  const paymentMethodId =
    typeof newest.payment_method === 'string' ? newest.payment_method : newest.payment_method!.id;

  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });

  const { data: profile } = await adminClient
    .from('user_payment_profiles')
    .select('user_id, default_payment_method_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (!profile || profile.default_payment_method_id === paymentMethodId) return;

  const { error } = await adminClient
    .from('user_payment_profiles')
    .update({ has_default_payment_method: true, default_payment_method_id: paymentMethodId })
    .eq('stripe_customer_id', customerId);
  if (error) throw new Error(`Could not record saved card: ${error.message}`);

  // Audit trail: card saves aren't tied to a ride payment.
  await adminClient.from('payment_events').insert({
    ride_payment_id: null,
    user_id: profile.user_id,
    from_status: profile.default_payment_method_id ? 'CARD_SAVED' : null,
    to_status: profile.default_payment_method_id ? 'CARD_REPLACED' : 'CARD_SAVED',
    actor_type: 'stripe',
    details: { payment_method_id: paymentMethodId, previous_payment_method_id: profile.default_payment_method_id },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  let stripe: Stripe | null;
  try {
    stripe = createStripeClient();
  } catch (err) {
    if (err instanceof LiveKeyError) return jsonResponse({ error: err.message }, 500);
    throw err;
  }
  if (!stripe || !webhookSecret) {
    return jsonResponse({ error: 'Payments are not configured.' }, 500);
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return jsonResponse({ error: 'Missing Stripe signature.' }, 400);
  }

  let event: Stripe.Event;
  try {
    // Async variant: Deno's SubtleCrypto only exposes the async API, unlike Node's.
    const payload = await req.text();
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch (err) {
    return jsonResponse({ error: `Invalid signature: ${(err as Error).message}` }, 400);
  }

  // Test mode only - a live event must never change anything here.
  if (event.livemode) {
    console.error(`REFUSING LIVE-MODE Stripe event ${event.id} (${event.type}). This prototype is test mode only.`);
    return jsonResponse({ error: 'Live-mode events are refused.' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: alreadyProcessed } = await adminClient
    .from('stripe_webhook_events')
    .select('event_id')
    .eq('event_id', event.id)
    .maybeSingle();
  if (alreadyProcessed) {
    return jsonResponse({ received: true, duplicate: true });
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as Stripe.Checkout.Session;
    const requestId = session.metadata?.requestId;

    if (requestId && session.payment_status === 'paid') {
      await adminClient
        .from('passenger_requests')
        .update({ service_fee_status: 'paid', service_fee_paid_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('stripe_checkout_session_id', session.id);
    }
  }

  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const requestId = session.metadata?.requestId;

    if (requestId) {
      // Let the passenger retry cleanly instead of getting stuck on "pending" forever.
      await adminClient
        .from('passenger_requests')
        .update({ service_fee_status: 'unpaid' })
        .eq('id', requestId)
        .eq('stripe_checkout_session_id', session.id)
        .eq('service_fee_status', 'pending');
    }
  }

  if (event.type === 'setup_intent.succeeded') {
    try {
      await recordSavedCard(stripe, adminClient, event.data.object as Stripe.SetupIntent);
    } catch (err) {
      // Not recorded as processed, so Stripe's automatic retry gets another go.
      console.error(`setup_intent.succeeded ${event.id} failed`, err);
      return jsonResponse({ error: 'Could not record saved card.' }, 500);
    }
  }

  if (event.type.startsWith('payment_intent.')) {
    try {
      // Always re-reads the hold from Stripe, so duplicate or out-of-order events converge on the
      // same state. Service-fee Checkout PaymentIntents carry no ride_payment_id and are skipped.
      await applyHoldState(adminClient, stripe, (event.data.object as Stripe.PaymentIntent).id, 'stripe');
    } catch (err) {
      console.error(`${event.type} ${event.id} failed`, err);
      return jsonResponse({ error: 'Could not record hold state.' }, 500);
    }
  }

  // Recorded only after handling succeeded. A concurrent duplicate may already have inserted it,
  // which is fine - every handler above is safe to run twice.
  await adminClient
    .from('stripe_webhook_events')
    .upsert({ event_id: event.id, event_type: event.type, livemode: event.livemode }, { onConflict: 'event_id', ignoreDuplicates: true });

  return jsonResponse({ received: true });
});
