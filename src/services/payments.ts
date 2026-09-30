import { base64ToArrayBuffer } from '../utils/base64';
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
  // Phase 6 - set once the taxi receipt is accepted, see 20260930000000_capture_and_reimburse.sql.
  // The share charged on top of the fee (0 for the payer).
  final_share_cents: number | null;
  taxi_total_cents: number | null;
  // When the card is charged (end of the dispute window).
  charge_at: string | null;
  captured_cents: number | null;
  released_cents: number | null;
  // Phase 7 - see 20261001000000_payment_failure_handling.sql.
  // taxi_total_cents is the group's estimate: the payer never sent a receipt.
  taxi_total_is_estimate: boolean;
  // Cancelling before this releases the whole reservation, FLOQQ fee included.
  free_cancel_until: string | null;
  // What couldn't be charged (failed capture, expired reservation) and whether that's been sorted out.
  outstanding_cents: number | null;
  outstanding_resolved_at: string | null;
};

// The passenger's own ride payment for their current group (RLS only returns their own rows).
export function fetchMyRidePayment(requestId: string, groupId: string) {
  return supabase
    .from('ride_payments')
    .select(
      'id, estimated_share_cents, hold_amount_cents, platform_fee_cents, payment_status, failure_reason, hold_window_opens_at, hold_deadline_at, final_share_cents, taxi_total_cents, charge_at, captured_cents, released_cents, taxi_total_is_estimate, free_cancel_until, outstanding_cents, outstanding_resolved_at'
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

// --- Phase 4: the designated payer and their payout setup (Stripe Connect) ---

export type PayoutStatus = 'NOT_STARTED' | 'PENDING' | 'COMPLETE' | 'RESTRICTED';

export type PayoutState = { status: PayoutStatus; detailsSubmitted: boolean };

// The passenger's payout setup as last saved (RLS only returns their own profile).
export async function fetchMyPayoutState() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { state: null as PayoutState | null, error: new Error('Not logged in.') };

  const { data, error } = await supabase
    .from('user_payment_profiles')
    .select('payout_onboarding_status, payout_details_submitted')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return { state: null as PayoutState | null, error };
  return {
    state: {
      status: (data?.payout_onboarding_status ?? 'NOT_STARTED') as PayoutStatus,
      detailsSubmitted: data?.payout_details_submitted ?? false,
    },
    error: null,
  };
}

// Asks Stripe (through payments-payout-onboarding) for the payout account's current state and saves it.
export async function refreshPayoutState() {
  const { data, error } = await supabase.functions.invoke('payments-payout-onboarding', { body: { action: 'status' } });
  if (error || !data?.status) return { state: null as PayoutState | null, error: error ?? new Error('No status.') };
  return { state: data as PayoutState, error: null };
}

// A one-time link to Stripe's payout setup pages. returnUrl is the app link to come back to.
export async function startPayoutOnboarding(returnUrl: string) {
  const { data, error } = await supabase.functions.invoke('payments-payout-onboarding', {
    body: { action: 'start', returnUrl },
  });
  if (error || !data?.url) return { url: null as string | null, error: error ?? new Error(data?.error ?? 'No link.') };
  return { url: data.url as string, error: null };
}

// --- Phase 5: the taxi receipt (prototype) ---

// ESTIMATED (phase 7): the payer didn't photograph the receipt in time - the group's estimated fare.
export type ReceiptStatus = 'ACCEPTED' | 'NEEDS_REVIEW' | 'REJECTED' | 'ESTIMATED';

export type RideReceipt = {
  status: ReceiptStatus;
  review_reasons: string[];
  review_note: string | null;
  total_cents: number;
  total_source: 'photo' | 'admin' | 'estimate';
  receipt_at: string | null;
  taxi_licence: string | null;
  receipt_number: string | null;
  photo_path: string | null;
  payer_share_cents: number;
  reimbursement_cents: number;
  holds_total_cents: number;
  guarantee_cents: number;
  guarantee_used: boolean;
  submitted_at: string;
  // Phase 6: when the others' cards are charged, and when that was done.
  settle_after: string | null;
  settled_at: string | null;
};

const RECEIPT_COLUMNS =
  'status, review_reasons, review_note, total_cents, total_source, receipt_at, taxi_licence, receipt_number, photo_path, payer_share_cents, reimbursement_cents, holds_total_cents, guarantee_cents, guarantee_used, submitted_at, settle_after, settled_at';

// The group's receipt, if the payer sent one (RLS: only the payer and the admin can read it).
export function fetchRideReceipt(groupId: string) {
  return supabase.from('ride_receipts').select(RECEIPT_COLUMNS).eq('group_id', groupId).maybeSingle<RideReceipt>();
}

const RECEIPT_BUCKET = 'ride-receipts';

// Only types the receipt reader accepts; the camera gives JPEG.
const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Uploads a receipt photo (base64, straight from the camera) into the group's folder of the
// private bucket. Returns its path, which goes to submitRideReceipt; the bucket only lets the
// group's payer upload there.
export async function uploadReceiptPhoto(groupId: string, base64: string, mimeType: string | null) {
  const contentType = mimeType && PHOTO_EXTENSIONS[mimeType] ? mimeType : 'image/jpeg';
  const path = `${groupId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${PHOTO_EXTENSIONS[contentType]}`;
  try {
    const body = base64ToArrayBuffer(base64);
    if (body.byteLength === 0) return { path: null as string | null, error: new Error('Empty photo.') };
    const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, body, { contentType });
    if (error) return { path: null as string | null, error };
  } catch (err) {
    return { path: null as string | null, error: err as Error };
  }
  return { path, error: null };
}

// A short-lived link to look at a receipt photo (payer or admin).
export async function receiptPhotoUrl(photoPath: string) {
  const { data } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(photoPath, 300);
  return data?.signedUrl ?? null;
}

export type SubmitReceiptResponse = {
  status?: 'ACCEPTED' | 'NEEDS_REVIEW';
  reasons?: string[];
  totalCents?: number;
  receiptAt?: string | null;
  error?: string;
  reason?: string;
};

// Sends the uploaded photo to be read and checked. The amount always comes from the photo.
export async function submitRideReceipt(groupId: string, photoPath: string) {
  const { data, error } = await supabase.functions.invoke('payments-submit-receipt', {
    body: { groupId, photoPath },
  });

  if (error) {
    // Business refusals (unreadable, too early, ...) come back as non-2xx with a JSON body.
    const context = (error as { context?: Response }).context;
    const body = context ? await context.json().catch(() => null) : null;
    return { result: (body ?? null) as SubmitReceiptResponse | null, error };
  }
  return { result: data as SubmitReceiptResponse, error: null };
}

// Admin: accept a receipt (optionally with a corrected total) or reject it.
export async function reviewRideReceipt(
  groupId: string,
  action: 'approve' | 'reject',
  options: { totalCents?: number; note?: string } = {}
) {
  const { data, error } = await supabase.functions.invoke('payments-review-receipt', {
    body: { groupId, action, ...options },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = context ? await context.json().catch(() => null) : null;
    return { error: (body?.error as string | undefined) ?? 'review_failed' };
  }
  return { error: (data?.error as string | undefined) ?? null };
}

// "38,50" / "38.5" / "€ 38" -> cents, or null if it isn't a plain euro amount.
export function parseEuroToCents(input: string): number | null {
  const normalized = input.replace(/[€\s]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

// --- Phase 6: the payer's reimbursement ---

// HELD_FOR_REVIEW (phase 7): from an estimated receipt - the admin approves it first.
export type PayoutProgress = 'WAITING_FOR_PAYOUT_SETUP' | 'PENDING' | 'SENT' | 'HELD_FOR_REVIEW';

export type RidePayout = {
  amount_cents: number;
  status: PayoutProgress;
  sent_at: string | null;
};

// The payer's reimbursement for a group, once the others have been charged (RLS: payer + admin).
export function fetchRidePayout(groupId: string) {
  return supabase.from('ride_payouts').select('amount_cents, status, sent_at').eq('group_id', groupId).maybeSingle<RidePayout>();
}

// --- Phase 7: payment problems the admin sorts out ---

export type OutstandingPayment = {
  id: string;
  group_id: string | null;
  outstanding_cents: number;
  outstanding_reason: string | null;
  outstanding_since: string | null;
  outstanding_note: string | null;
  passenger_requests: { passenger_name: string | null; flight_number: string } | null;
};

export type PayoutIssue = {
  group_id: string;
  amount_cents: number;
  status: PayoutProgress;
  failure_reason: string | null;
};

export type ReceiptIssue = { group_id: string; status: ReceiptStatus };

export type GroupWithoutReceipt = { id: string; receipt_deadline_at: string };

export type PaymentIssues = {
  outstanding: OutstandingPayment[];
  payouts: PayoutIssue[];
  receipts: ReceiptIssue[];
  // Earliest hold expiry per group, for receipts still waiting.
  holdExpiries: Record<string, string>;
  // Rides whose payer hasn't sent a receipt, and when FLOQQ falls back to the estimate.
  missingReceipts: GroupWithoutReceipt[];
};

// Everything that needs the admin (RLS: admin reads all of these).
export async function fetchPaymentIssues(): Promise<{ issues: PaymentIssues | null; error: Error | null }> {
  const [outstanding, payouts, receipts, missing] = await Promise.all([
    supabase
      .from('ride_payments')
      .select('id, group_id, outstanding_cents, outstanding_reason, outstanding_since, outstanding_note, passenger_requests(passenger_name, flight_number)')
      .gt('outstanding_cents', 0)
      .is('outstanding_resolved_at', null)
      .order('outstanding_since', { ascending: true })
      .returns<OutstandingPayment[]>(),
    supabase
      .from('ride_payouts')
      .select('group_id, amount_cents, status, failure_reason')
      .or('status.eq.HELD_FOR_REVIEW,and(status.neq.SENT,failure_reason.not.is.null)')
      .returns<PayoutIssue[]>(),
    supabase
      .from('ride_receipts')
      .select('group_id, status')
      .in('status', ['NEEDS_REVIEW', 'REJECTED'])
      .is('settlement_started_at', null)
      .returns<ReceiptIssue[]>(),
    supabase
      .from('taxi_groups')
      .select('id, receipt_deadline_at')
      .eq('status', 'confirmed')
      .not('receipt_deadline_at', 'is', null)
      .returns<GroupWithoutReceipt[]>(),
  ]);
  const error = outstanding.error ?? payouts.error ?? receipts.error ?? missing.error;
  if (error) return { issues: null, error };

  const receiptGroupIds = new Set((receipts.data ?? []).map((r) => r.group_id));
  const { data: allReceipts } = await supabase
    .from('ride_receipts')
    .select('group_id, status')
    .in('group_id', (missing.data ?? []).map((g) => g.id));
  const withReceipt = new Set((allReceipts ?? []).filter((r) => r.status !== 'REJECTED').map((r) => r.group_id));
  const missingReceipts = (missing.data ?? []).filter((g) => !withReceipt.has(g.id) && !receiptGroupIds.has(g.id));

  const waitingGroupIds = [...receiptGroupIds, ...missingReceipts.map((g) => g.id)];
  const holdExpiries: Record<string, string> = {};
  if (waitingGroupIds.length) {
    const { data: holds } = await supabase
      .from('ride_payments')
      .select('group_id, hold_expires_at')
      .in('group_id', waitingGroupIds)
      .eq('payment_status', 'HOLD_PLACED')
      .not('hold_expires_at', 'is', null);
    for (const hold of holds ?? []) {
      const current = holdExpiries[hold.group_id];
      if (!current || new Date(hold.hold_expires_at).getTime() < new Date(current).getTime()) {
        holdExpiries[hold.group_id] = hold.hold_expires_at;
      }
    }
  }

  return {
    issues: {
      outstanding: outstanding.data ?? [],
      payouts: payouts.data ?? [],
      receipts: receipts.data ?? [],
      holdExpiries,
      missingReceipts,
    },
    error: null,
  };
}

export type AdminPaymentAction =
  | { action: 'recharge'; ridePaymentId: string }
  | { action: 'write_off'; ridePaymentId: string; note?: string }
  | { action: 'approve_payout'; groupId: string };

// Admin: charge an outstanding amount again, write it off, or release a held payout.
export async function runAdminPaymentAction(body: AdminPaymentAction) {
  const { data, error } = await supabase.functions.invoke('payments-admin-actions', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const response = context ? await context.json().catch(() => null) : null;
    return { error: (response?.error as string | undefined) ?? 'action_failed' };
  }
  return { error: (data?.error as string | undefined) ?? null };
}
