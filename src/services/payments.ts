import { supabase } from './supabase';

// Starts a Stripe Checkout session for the fixed FLOQQ service fee for one passenger request.
// The Stripe secret key lives only in the create-service-fee-checkout Edge Function - the app
// just receives a hosted Checkout URL to open (see MyRideScreen).
export async function createServiceFeeCheckout(requestId: string) {
  const { data, error } = await supabase.functions.invoke('create-service-fee-checkout', {
    body: { requestId },
  });

  if (error) {
    return { url: null as string | null, error };
  }
  if (!data?.url) {
    return { url: null as string | null, error: new Error(data?.error ?? 'Could not start checkout.') };
  }
  return { url: data.url as string, error: null };
}

// --- Stripe TEST-MODE payments prototype (behind PAYMENTS_ENABLED) ---

export type CardSetupSession = {
  setupIntentClientSecret: string;
  customerId: string;
  publishableKey: string;
  merchantCountryCode: string;
};

// Asks the payments-setup-card Edge Function to prepare a PaymentSheet "save card" session.
// attemptId is fresh per "Add card" tap so a retried request reuses the same SetupIntent.
export async function createCardSetupSession(attemptId: string) {
  const { data, error } = await supabase.functions.invoke('payments-setup-card', { body: { attemptId } });

  if (error) {
    return { session: null as CardSetupSession | null, error };
  }
  if (!data?.setupIntentClientSecret || !data?.publishableKey) {
    return { session: null as CardSetupSession | null, error: new Error(data?.error ?? 'Could not start card setup.') };
  }
  return { session: data as CardSetupSession, error: null };
}

export type SavedCard = {
  paymentMethodId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  wallet: string | null;
};

// Brand + last 4 of the passenger's saved card, or null if none is saved yet.
export async function fetchSavedCard() {
  const { data, error } = await supabase.functions.invoke('payments-get-card', { body: {} });

  if (error) {
    return { card: null as SavedCard | null, error };
  }
  return { card: (data?.card ?? null) as SavedCard | null, error: null };
}
