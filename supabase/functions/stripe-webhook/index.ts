// Receives Stripe's Checkout events for the FLOQQ service fee (see create-service-fee-checkout)
// and marks the corresponding passenger_requests row paid once Stripe confirms the charge.
// Stripe calls this directly with no Supabase session, so it must be deployed with
// --no-verify-jwt and does its own auth via the Stripe signature instead (mirrors match-and-group,
// which is unauthenticated-by-Supabase-JWT for the same reason: a cron job calls that one).

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeSecretKey || !webhookSecret) {
    return jsonResponse({ error: 'Payments are not configured.' }, 500);
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return jsonResponse({ error: 'Missing Stripe signature.' }, 400);
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2025-08-27.basil' });

  let event: Stripe.Event;
  try {
    // Async variant: Deno's SubtleCrypto only exposes the async API, unlike Node's.
    const payload = await req.text();
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
  } catch (err) {
    return jsonResponse({ error: `Invalid signature: ${(err as Error).message}` }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

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

  return jsonResponse({ received: true });
});
