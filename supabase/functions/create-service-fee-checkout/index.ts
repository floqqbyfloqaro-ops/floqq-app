// Starts a Stripe Checkout session for the fixed FLOQQ service fee (SERVICE_FEE_EUR per
// passenger, src/screens/MyRideScreen.tsx) once a passenger's taxi group has been confirmed.
// This only ever charges the flat service fee - the taxi fare itself keeps being split via
// _shared/fareSplit.ts and settled directly between passengers/driver, untouched by this flow.
//
// The Stripe secret key never reaches the client: this function builds the session server-side
// and only ever hands the app a hosted Checkout URL to open. Deployed with the default JWT
// verification (any logged-in app user may call this); ownership of the passenger request is
// enforced by re-querying through a client scoped to the caller's own JWT, so RLS does the
// authorization check for us instead of us hand-rolling it.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { SERVICE_FEE_EUR } from '../_shared/constants.ts';
import { createStripeClient, LiveKeyError } from '../_shared/stripe.ts';

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

// Custom URL scheme the app registers (app.json "scheme") so Checkout can hand control back to
// FLOQQ once the passenger finishes paying in the system browser.
const APP_SCHEME = Deno.env.get('APP_SCHEME') ?? 'floqq';

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

  // Refuses a live key outright - see _shared/stripe.ts.
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Scoped to the caller's own JWT so every read below is automatically restricted by RLS to
  // rows they own - this is what proves the passenger request and group actually belong to them.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { data: passengerRequest, error: requestError } = await callerClient
    .from('passenger_requests')
    .select('id, group_id, service_fee_status')
    .eq('id', requestId)
    .single();

  if (requestError || !passengerRequest) {
    return jsonResponse({ error: 'Request not found.' }, 404);
  }
  if (passengerRequest.service_fee_status === 'paid') {
    return jsonResponse({ error: 'Service fee already paid.' }, 400);
  }
  if (!passengerRequest.group_id) {
    return jsonResponse({ error: 'You are not part of a confirmed group yet.' }, 400);
  }

  const { data: group, error: groupError } = await callerClient
    .from('taxi_groups')
    .select('id, status')
    .eq('id', passengerRequest.group_id)
    .single();

  if (groupError || !group) {
    return jsonResponse({ error: 'Group not found.' }, 404);
  }
  if (group.status !== 'confirmed') {
    return jsonResponse({ error: 'Your group is not confirmed yet.' }, 400);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(SERVICE_FEE_EUR * 100),
          product_data: { name: 'FLOQQ service fee' },
        },
        quantity: 1,
      },
    ],
    success_url: `${APP_SCHEME}://payment-success`,
    cancel_url: `${APP_SCHEME}://payment-cancelled`,
    metadata: { requestId, userId: user.id },
  });

  // Service-role client: passengers have no update policy on these columns on purpose (see the
  // service_fee_payments migration), so recording the pending session requires elevated access.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error: updateError } = await adminClient
    .from('passenger_requests')
    .update({ service_fee_status: 'pending', stripe_checkout_session_id: session.id })
    .eq('id', requestId);

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500);
  }

  return jsonResponse({ url: session.url });
});
