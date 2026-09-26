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

export type RidePaymentStatus =
  | 'NOT_STARTED'
  | 'HOLD_PENDING_AUTH'
  | 'HOLD_PLACED'
  | 'HOLD_FAILED'
  | 'CAPTURED'
  | 'RELEASED'
  | 'CAPTURE_FAILED'
  | 'REFUNDED';

export type RidePayment = {
  id: string;
  estimated_share_cents: number;
  hold_amount_cents: number;
  platform_fee_cents: number;
  payment_status: RidePaymentStatus;
  failure_reason: string | null;
  hold_window_opens_at: string | null;
  hold_deadline_at: string | null;
};

// The passenger's own ride payment for their current group (RLS only returns their own rows).
export function fetchMyRidePayment(requestId: string, groupId: string) {
  return supabase
    .from('ride_payments')
    .select(
      'id, estimated_share_cents, hold_amount_cents, platform_fee_cents, payment_status, failure_reason, hold_window_opens_at, hold_deadline_at'
    )
    .eq('request_id', requestId)
    .eq('group_id', groupId)
    .maybeSingle<RidePayment>();
}

export type PlaceHoldResponse = {
  status?: RidePaymentStatus;
  clientSecret?: string;
  publishableKey?: string;
  reason?: string;
  error?: string;
};

// Asks the payments-place-hold Edge Function to reserve this ride payment on the saved card.
export async function placeRideHold(ridePaymentId: string, returnUrl: string) {
  const { data, error } = await supabase.functions.invoke('payments-place-hold', {
    body: { ridePaymentId, returnUrl },
  });

  if (error) {
    // Business refusals (no card, deadline passed, ...) come back as non-2xx with a JSON body.
    const context = (error as { context?: Response }).context;
    const body = context ? await context.json().catch(() => null) : null;
    return { result: (body ?? null) as PlaceHoldResponse | null, error };
  }
  return { result: data as PlaceHoldResponse, error: null };
}

// Admin: creates a just-confirmed group's hold rows right away instead of waiting for the next
// 5-minute payments-sync-holds run.
export function syncGroupHolds(groupId: string) {
  return supabase.functions.invoke('payments-sync-holds', { body: { groupId } });
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
