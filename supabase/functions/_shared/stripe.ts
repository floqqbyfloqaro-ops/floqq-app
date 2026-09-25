// Shared Stripe setup for every Edge Function that talks to Stripe. This is a TEST-MODE-only
// prototype: any live key (sk_live_ / rk_live_ / pk_live_) is refused outright, so a mis-pasted
// Supabase secret can never charge real money. Keys only ever come from Supabase secrets.

import Stripe from 'npm:stripe@17';

export const STRIPE_API_VERSION = '2025-08-27.basil';

const LIVE_KEY_PATTERN = /^(sk|rk|pk)_live_/;

export class LiveKeyError extends Error {}

// Throws (loudly, with the secret's name - never its value) if a live key is configured.
export function assertTestKey(name: string, value: string): void {
  if (LIVE_KEY_PATTERN.test(value)) {
    console.error(`REFUSING TO RUN: ${name} is a LIVE Stripe key. This prototype is test mode only.`);
    throw new LiveKeyError(`${name} is a live Stripe key - test mode only.`);
  }
}

// The payments prototype (card saving, holds, captures, payouts) is off unless the
// PAYMENTS_ENABLED secret is exactly "true". The older service-fee Checkout flow doesn't use this.
export function paymentsEnabled(): boolean {
  return Deno.env.get('PAYMENTS_ENABLED') === 'true';
}

// Returns a Stripe client, or null if STRIPE_SECRET_KEY isn't configured. Throws LiveKeyError
// on a live key.
export function createStripeClient(): Stripe | null {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secretKey) return null;
  assertTestKey('STRIPE_SECRET_KEY', secretKey);
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
}

// The publishable key is safe to hand to the app, but still test-only.
export function getPublishableKey(): string | null {
  const publishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY');
  if (!publishableKey) return null;
  assertTestKey('STRIPE_PUBLISHABLE_KEY', publishableKey);
  return publishableKey;
}
