// Pure capture/reimbursement rules for the payments prototype's settlement (phase 6). No Deno or
// network imports, so it runs under the plain Node test in settlementMath.test.ts. All amounts
// are integer cents, EUR.
//
// Separate charges and transfers: each passenger's hold is captured on FLOQQ's own Stripe account,
// then the payer is paid with one transfer per captured passenger, each tied to that passenger's
// charge (source_transaction) so it only moves once that charge's money is available. Whatever the
// captures don't cover (the Ride Payment Guarantee, or a capture that failed) is one more transfer
// from FLOQQ's own balance.

// How long after a receipt is accepted the passengers can still query it before their cards are
// charged. Overridable with the DISPUTE_WINDOW_HOURS secret (see receipts.ts).
export const DEFAULT_DISPUTE_WINDOW_HOURS = 2;

// Capture at least this long before the first hold expires, whatever the dispute window says:
// Stripe can't capture an expired hold.
export const CAPTURE_BEFORE_HOLD_EXPIRY_MINUTES = 60;

const MINUTE_MS = 60_000;

// When the cards are charged: the end of the dispute window, but never later than the capture
// margin before the first hold expires (and never in the past).
export function settleAfterMs(acceptedMs: number, windowHours: number, earliestHoldExpiryMs: number | null): number {
  const windowEndMs = acceptedMs + windowHours * 60 * MINUTE_MS;
  if (earliestHoldExpiryMs == null) return windowEndMs;
  const latestSafeMs = earliestHoldExpiryMs - CAPTURE_BEFORE_HOLD_EXPIRY_MINUTES * MINUTE_MS;
  return Math.max(acceptedMs, Math.min(windowEndMs, latestSafeMs));
}

export type CaptureInput = {
  holdAmountCents: number;
  platformFeeCents: number;
  // The part of the receipt share to capture from this hold (final_share_cents): 0 for the payer.
  captureShareCents: number;
};

export type CapturePlan = {
  captureCents: number;
  releasedCents: number;
};

// What to capture from one placed hold: the passenger's share plus the FLOQQ fee (only the fee for
// the payer), never more than was held. Capturing less than the hold releases the rest.
export function capturePlan(input: CaptureInput): CapturePlan {
  const captureCents = Math.min(input.holdAmountCents, input.captureShareCents + input.platformFeeCents);
  return { captureCents, releasedCents: input.holdAmountCents - captureCents };
}

export type CapturedShare = {
  id: string;
  // The share captured on top of the fee - what goes on to the payer from this charge.
  shareCents: number;
};

export type PayoutPlan = {
  // One transfer per captured passenger share, each from that passenger's charge.
  fromCaptures: CapturedShare[];
  fromCapturesCents: number;
  // The rest of the reimbursement, from FLOQQ's own balance.
  guaranteeCents: number;
};

// Splits the payer's reimbursement (taxi total minus their own share) into the transfers that make
// it up. The payer always gets the full reimbursement.
export function payoutPlan(reimbursementCents: number, captured: CapturedShare[]): PayoutPlan {
  const fromCaptures = captured.filter((c) => c.shareCents > 0);
  const fromCapturesCents = fromCaptures.reduce((sum, c) => sum + c.shareCents, 0);
  return {
    fromCaptures,
    fromCapturesCents,
    guaranteeCents: Math.max(0, reimbursementCents - fromCapturesCents),
  };
}

// --- Phase 7: failure handling ---

// A passenger who cancels at least this long before the ride leaves gets their whole seat
// reservation back, FLOQQ fee included: the others still have time to be matched again. Later
// than that, the fee is kept and the rest released.
export const FREE_CANCELLATION_HOURS = 24;

export function freeCancelUntilMs(rideMs: number): number {
  return rideMs - FREE_CANCELLATION_HOURS * 60 * MINUTE_MS;
}

// The payer is reminded to photograph the receipt this long after the ride leaves, and once more
// this long before the deadline. At the deadline FLOQQ falls back to the group's estimated fare.
export const RECEIPT_REMINDER_AFTER_RIDE_MINUTES = 60;
export const RECEIPT_FINAL_REMINDER_BEFORE_DEADLINE_HOURS = 4;
export const RECEIPT_DEADLINE_AFTER_RIDE_HOURS = 24;

// The fallback still needs its dispute window and the capture margin before the first hold expires.
export const RECEIPT_DEADLINE_BEFORE_HOLD_EXPIRY_HOURS = 4;

// When the payer's time to photograph the receipt runs out.
export function receiptDeadlineMs(departureMs: number, earliestHoldExpiryMs: number | null): number {
  const deadlineMs = departureMs + RECEIPT_DEADLINE_AFTER_RIDE_HOURS * 60 * MINUTE_MS;
  if (earliestHoldExpiryMs == null) return deadlineMs;
  const latestSafeMs = earliestHoldExpiryMs - RECEIPT_DEADLINE_BEFORE_HOLD_EXPIRY_HOURS * 60 * MINUTE_MS;
  return Math.max(departureMs, Math.min(deadlineMs, latestSafeMs));
}

export type MissingReceiptStep = 'wait' | 'reminder' | 'final_reminder' | 'fallback';

// What to do about a ride whose payer hasn't sent a (valid) receipt yet. Each reminder is sent once;
// the caller says which ones already went out. When the final reminder is due the first one is
// skipped (the caller marks both as sent), so the payer never gets two in a row.
export function missingReceiptStep(
  nowMs: number,
  departureMs: number,
  deadlineMs: number,
  sent: { reminder: boolean; finalReminder: boolean }
): MissingReceiptStep {
  if (nowMs >= deadlineMs) return 'fallback';
  if (!sent.finalReminder && nowMs >= deadlineMs - RECEIPT_FINAL_REMINDER_BEFORE_DEADLINE_HOURS * 60 * MINUTE_MS) {
    return 'final_reminder';
  }
  if (!sent.reminder && !sent.finalReminder && nowMs >= departureMs + RECEIPT_REMINDER_AFTER_RIDE_MINUTES * MINUTE_MS) {
    return 'reminder';
  }
  return 'wait';
}

// What a passenger still owes when their hold couldn't be captured (capture failed, or the hold
// expired first): what the capture would have taken - the share (not for the payer) plus the fee.
// The payer was made whole by FLOQQ regardless.
export function outstandingCents(input: { isPayer: boolean; finalShareCents: number | null; platformFeeCents: number }): number {
  return (input.isPayer ? 0 : input.finalShareCents ?? 0) + input.platformFeeCents;
}
