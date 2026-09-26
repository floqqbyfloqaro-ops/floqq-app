// Native (iOS/Android) card saving through Stripe's PaymentSheet: Google Pay / Apple Pay first
// (when the device supports them), manual card entry as fallback. The web build uses
// cardSetup.web.ts instead - Stripe's React Native SDK has no web support.
//
// A "saved" result here only means the sheet finished. The card only counts as saved once the
// stripe-webhook function has recorded it, so callers re-fetch the card from the server.

import * as Linking from 'expo-linking';

import { colors, radii } from '../theme/colors';
import type { CardSetupSession } from './payments';

export const CARD_SETUP_SUPPORTED = true;

// Loaded lazily so the native Stripe module is only touched once payments are actually used - with
// PAYMENTS_ENABLED off, app startup never depends on it.
function loadStripe(): typeof import('@stripe/stripe-react-native') {
  return require('@stripe/stripe-react-native');
}

export type CardSetupResult = { status: 'saved' } | { status: 'cancelled' } | { status: 'failed'; message: string };

export async function presentCardSetupSheet(session: CardSetupSession, merchantDisplayName: string): Promise<CardSetupResult> {
  // Second line of defense after the server's own check: never initialize Stripe with a live key.
  if (!session.publishableKey.startsWith('pk_test_')) {
    console.error('Refusing a non-test Stripe publishable key. This prototype is test mode only.');
    return { status: 'failed', message: 'Test mode only.' };
  }

  const { initStripe, initPaymentSheet, presentPaymentSheet, PaymentSheetError } = loadStripe();

  await initStripe({ publishableKey: session.publishableKey });

  const { error: initError } = await initPaymentSheet({
    merchantDisplayName,
    setupIntentClientSecret: session.setupIntentClientSecret,
    customerId: session.customerId,
    // Brings the passenger back into FLOQQ after a bank's 3D Secure page.
    returnURL: stripeReturnUrl(),
    googlePay: {
      merchantCountryCode: session.merchantCountryCode,
      currencyCode: 'EUR',
      testEnv: true,
    },
    style: 'alwaysDark',
    appearance: {
      colors: {
        primary: colors.accentPrimary,
        background: colors.bgElevated,
        componentBackground: colors.surfaceCardSolid,
        componentBorder: colors.borderSubtle,
        componentDivider: colors.borderSubtle,
        primaryText: colors.textPrimary,
        secondaryText: colors.textSecondary,
        componentText: colors.textPrimary,
        placeholderText: colors.textDisabled,
        icon: colors.textSecondary,
        error: colors.danger,
      },
      shapes: { borderRadius: radii.md },
    },
  });
  if (initError) {
    return { status: 'failed', message: initError.localizedMessage ?? initError.message };
  }

  const { error } = await presentPaymentSheet();
  if (!error) {
    return { status: 'saved' };
  }
  if (error.code === PaymentSheetError.Canceled) {
    return { status: 'cancelled' };
  }
  return { status: 'failed', message: error.localizedMessage ?? error.message };
}

// Forwards a deep link to Stripe (3D Secure / bank redirect returns). Returns true if it was
// Stripe's, so the caller can skip its own handling.
export function handleStripeRedirect(url: string): Promise<boolean> {
  return loadStripe().handleURLCallback(url);
}

// URL the bank's 3D Secure page returns to (the FLOQQ app, or Expo Go while developing).
export function stripeReturnUrl(): string {
  return Linking.createURL('stripe-redirect');
}

export type HoldAuthResult = { status: 'done' } | { status: 'failed'; message: string };

// Shows the bank's 3D Secure step for a ride hold that needs it. "done" only means the step
// finished - whether the hold was placed is read back from the server (Stripe's webhook).
export async function authenticateHold(clientSecret: string, publishableKey: string): Promise<HoldAuthResult> {
  if (!publishableKey.startsWith('pk_test_')) {
    console.error('Refusing a non-test Stripe publishable key. This prototype is test mode only.');
    return { status: 'failed', message: 'Test mode only.' };
  }

  const { initStripe, handleNextAction } = loadStripe();
  await initStripe({ publishableKey });

  const { error } = await handleNextAction(clientSecret, stripeReturnUrl());
  if (error) {
    return { status: 'failed', message: error.localizedMessage ?? error.message };
  }
  return { status: 'done' };
}
