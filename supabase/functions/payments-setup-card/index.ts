// Prepares Stripe's PaymentSheet to save a passenger's card (or Google Pay / Apple Pay) once, for
// later holds. Creates the Stripe Customer on first use, then a SetupIntent the app confirms
// through PaymentSheet. The app only ever receives the SetupIntent's client secret and the TEST
// publishable key - never the secret key. Whether the card was actually saved is decided solely by
// the stripe-webhook function (setup_intent.succeeded), never by the app.
//
// Deployed with the default JWT verification (any logged-in app user may call this).

import { createClient } from 'npm:@supabase/supabase-js@2';

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

// Country of the FLOQQ Stripe account, which Google Pay needs. Configurable because the company
// (and so the account's country) isn't settled yet.
const MERCHANT_COUNTRY = Deno.env.get('STRIPE_MERCHANT_COUNTRY') ?? 'ES';

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

  let stripe;
  let publishableKey;
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

  // A fresh id per "Add card" tap, so a retried request for the same tap reuses the same
  // SetupIntent instead of creating a second one.
  let attemptId = '';
  try {
    const body = await req.json();
    attemptId = typeof body?.attemptId === 'string' ? body.attemptId : '';
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  if (!/^[0-9a-zA-Z-]{8,64}$/.test(attemptId)) {
    return jsonResponse({ error: 'attemptId is required.' }, 400);
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

  // Service role: passengers can only read their payment profile, never write it.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile, error: profileError } = await adminClient
    .from('user_payment_profiles')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profileError) {
    return jsonResponse({ error: profileError.message }, 500);
  }

  let customerId = profile?.stripe_customer_id ?? null;
  if (!customerId) {
    // Idempotency key per user: two simultaneous first taps get the same Customer back from Stripe.
    const customer = await stripe.customers.create(
      { email: user.email, metadata: { user_id: user.id } },
      { idempotencyKey: `floqq-customer-${user.id}` }
    );
    customerId = customer.id;

    const { error: upsertError } = await adminClient
      .from('user_payment_profiles')
      .upsert({ user_id: user.id, stripe_customer_id: customerId }, { onConflict: 'user_id' });
    if (upsertError) {
      return jsonResponse({ error: upsertError.message }, 500);
    }
  }

  // Cards only (Google Pay / Apple Pay are cards too), saved for later holds that may happen
  // while the passenger isn't looking at the app.
  const setupIntent = await stripe.setupIntents.create(
    {
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: { user_id: user.id },
    },
    { idempotencyKey: `floqq-setup-${user.id}-${attemptId}` }
  );

  return jsonResponse({
    setupIntentClientSecret: setupIntent.client_secret,
    customerId,
    publishableKey,
    merchantCountryCode: MERCHANT_COUNTRY,
  });
});
