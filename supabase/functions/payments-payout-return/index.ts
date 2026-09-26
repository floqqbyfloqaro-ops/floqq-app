// Payments prototype, phase 4: where Stripe's payout onboarding sends the payer when they finish
// (state=done) or when the link expired (state=expired). Stripe only accepts https links, so this
// just redirects on to the app link the app gave payments-payout-onboarding - the in-app browser
// then closes and the app re-reads the payout status from Stripe itself. Nothing here is trusted.
//
// Deployed with --no-verify-jwt (a plain browser redirect carries no login).

const APP_LINK_PATTERN = /^(floqq|exp|exps):\/\//;

Deno.serve((req) => {
  const url = new URL(req.url);
  const to = url.searchParams.get('to') ?? '';
  const state = url.searchParams.get('state') === 'expired' ? 'expired' : 'done';

  // Only ever redirect to the app, never to an arbitrary website.
  if (!APP_LINK_PATTERN.test(to)) {
    return new Response('Please go back to the FLOQQ app.', { status: 400 });
  }

  const target = `${to}${to.includes('?') ? '&' : '?'}payout=${state}`;
  return new Response(null, { status: 302, headers: { Location: target } });
});
