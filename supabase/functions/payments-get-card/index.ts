// Returns the caller's saved card for Profile -> Payment methods: brand + last 4 digits (and the
// wallet, e.g. Google Pay) only. Card details live in Stripe, never in our database - we only keep
// Stripe's pm_... reference, which the stripe-webhook function sets once Stripe confirms the save.
//
// Deployed with the default JWT verification (any logged-in app user may call this).

import { createClient } from 'npm:@supabase/supabase-js@2';

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
  try {
    stripe = createStripeClient();
  } catch (err) {
    if (err instanceof LiveKeyError) return jsonResponse({ error: err.message }, 500);
    throw err;
  }
  if (!stripe) {
    return jsonResponse({ error: 'Payments are not configured.' }, 500);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Scoped to the caller's JWT: RLS only returns their own payment profile.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { data: profile, error: profileError } = await callerClient
    .from('user_payment_profiles')
    .select('has_default_payment_method, default_payment_method_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profileError) {
    return jsonResponse({ error: profileError.message }, 500);
  }
  if (!profile?.has_default_payment_method || !profile.default_payment_method_id) {
    return jsonResponse({ card: null });
  }

  const paymentMethod = await stripe.paymentMethods.retrieve(profile.default_payment_method_id);
  const card = paymentMethod.card;
  if (!card) {
    return jsonResponse({ card: null });
  }

  return jsonResponse({
    card: {
      paymentMethodId: paymentMethod.id,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.exp_month,
      expYear: card.exp_year,
      wallet: card.wallet?.type ?? null,
    },
  });
});
