// Web build: Stripe's React Native SDK has no web support, so card saving is only offered in the
// mobile app (see cardSetup.ts). ProfileScreen shows a "use the mobile app" note instead.

import type { CardSetupSession } from './payments';

export const CARD_SETUP_SUPPORTED = false;

export type CardSetupResult = { status: 'saved' } | { status: 'cancelled' } | { status: 'failed'; message: string };

export async function presentCardSetupSheet(_session: CardSetupSession, _merchantDisplayName: string): Promise<CardSetupResult> {
  return { status: 'failed', message: 'Not supported on web.' };
}

export async function handleStripeRedirect(_url: string): Promise<boolean> {
  return false;
}

export function stripeReturnUrl(): string {
  return '';
}

export type HoldAuthResult = { status: 'done' } | { status: 'failed'; message: string };

export async function authenticateHold(_clientSecret: string, _publishableKey: string): Promise<HoldAuthResult> {
  return { status: 'failed', message: 'Not supported on web.' };
}
