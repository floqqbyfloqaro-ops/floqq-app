// Payments prototype, phase 4: payout setup for the designated payer, through Stripe Connect
// (Accounts v2, "recipient" only - it can receive transfers from FLOQQ and pay them out to the
// payer's bank, nothing else - with the Express dashboard. For an individual in Spain: name,
// date of birth, address, phone, nationality, IBAN, Stripe's terms, and an ID check only if Stripe
// can't verify them otherwise). All of it is entered on Stripe's own pages - FLOQQ never sees it.
//   { action: 'start', returnUrl }  -> creates the connected account on first use, then returns a
//                                      one-time Stripe onboarding link (url) to open in the app.
//   { action: 'status' }            -> re-reads the account from Stripe, saves and returns its
//                                      state (the app calls this when the passenger comes back).
// Any logged-in passenger may set up payouts (agreed "pay now, set up later": also after the ride).
//
// Deployed with the default JWT verification.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { retrievePayoutAccount, savePayoutStatus, stripeV2 } from '../_shared/payer.ts';
import { LiveKeyError, paymentsEnabled } from '../_shared/stripe.ts';

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

// Passengers are in Barcelona; the payout account's country (lowercase in the v2 API).
const PAYOUT_COUNTRY = 'es';

// Stripe only accepts https return links, so it returns to payments-payout-return, which sends the
// browser on to the app link (floqq://..., or exp://... in Expo Go).
const APP_LINK_PATTERN = /^(floqq|exp|exps):\/\//;

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

  let action = '';
  let returnUrl = '';
  try {
    const body = await req.json();
    action = typeof body?.action === 'string' ? body.action : '';
    returnUrl = typeof body?.returnUrl === 'string' ? body.returnUrl : '';
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  if (action !== 'start' && action !== 'status') {
    return jsonResponse({ error: 'Unknown action.' }, 400);
  }
  if (action === 'start' && !APP_LINK_PATTERN.test(returnUrl)) {
    return jsonResponse({ error: 'returnUrl must be an app link.' }, 400);
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
    .select('stripe_connect_account_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profileError) {
    return jsonResponse({ error: profileError.message }, 500);
  }

  let accountId = profile?.stripe_connect_account_id ?? null;

  try {
    if (action === 'status') {
      if (!accountId) return jsonResponse({ status: 'NOT_STARTED', detailsSubmitted: false });
      return jsonResponse(await savePayoutStatus(adminClient, user.id, await retrievePayoutAccount(accountId)));
    }

    if (!accountId) {
      // Idempotency key per user: two simultaneous first taps get the same account back from Stripe.
      // Express dashboard requires FLOQQ (the "application") to cover the account's Stripe fees and
      // negative balances - for an account that only receives money there is nothing to lose.
      const account = await stripeV2<{ id: string }>('POST', '/v2/core/accounts', {
        body: {
          contact_email: user.email,
          display_name: user.email,
          dashboard: 'express',
          identity: { country: PAYOUT_COUNTRY, entity_type: 'individual' },
          configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
          defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
          metadata: { user_id: user.id },
        },
        idempotencyKey: `floqq-connect-v2-${user.id}`,
      });
      accountId = account.id;

      const { error: upsertError } = await adminClient
        .from('user_payment_profiles')
        .upsert(
          { user_id: user.id, stripe_connect_account_id: accountId, payout_onboarding_status: 'PENDING' },
          { onConflict: 'user_id' }
        );
      if (upsertError) {
        return jsonResponse({ error: upsertError.message }, 500);
      }
    }

    // Account links are single-use and expire after a few minutes, so a fresh one per tap (no
    // idempotency key - replaying one would hand back an already-used link).
    const back = (state: string) =>
      `${supabaseUrl}/functions/v1/payments-payout-return?state=${state}&to=${encodeURIComponent(returnUrl)}`;
    const link = await stripeV2<{ url: string }>('POST', '/v2/core/account_links', {
      body: {
        account: accountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            configurations: ['recipient'],
            // Ask for everything Stripe will ever need now, so the payer isn't interrupted later.
            collection_options: { fields: 'eventually_due' },
            return_url: back('done'),
            refresh_url: back('expired'),
          },
        },
      },
    });

    return jsonResponse({ url: link.url });
  } catch (err) {
    if (err instanceof LiveKeyError) return jsonResponse({ error: err.message }, 500);
    console.error('payout onboarding failed', err);
    return jsonResponse({ error: 'stripe_error' }, 502);
  }
});
