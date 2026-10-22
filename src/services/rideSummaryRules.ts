// The pure rules behind the "Ride completed" summary - no imports, so a plain Node test loads this
// file directly (rideSummaryRules.test.mjs). The one promise they keep: nothing reads "Paid"
// unless it was actually paid.

// What the ride-summary Edge Function reports for one passenger (supabase/functions/ride-summary).
export type RideSummaryFacts = {
  paymentsEnabled: boolean;
  isPayer: boolean;
  platformFeeCents: number;
  estimatedTotalCents: number | null;
  estimatedShareCents: number | null;
  // A receipt that wasn't rejected. ESTIMATED: none came in time, the estimate was used instead.
  receipt: {
    status: 'ACCEPTED' | 'NEEDS_REVIEW' | 'ESTIMATED';
    totalCents: number;
    payerShareCents: number | null;
    reimbursementCents: number | null;
  } | null;
  // What FLOQQ did with this passenger's card (payments on).
  payment: { status: string; finalShareCents: number | null; capturedCents: number | null } | null;
  // Payments off: the separate FLOQQ fee payment.
  serviceFeeStatus: 'unpaid' | 'pending' | 'paid' | null;
  // The payer's reimbursement, once it exists.
  payout: { amountCents: number; status: string } | null;
};

// "Paid" only when charged; "Paid to the taxi" for the payer's own share; "Pending" while it will
// still be charged; "Payment problem" when charging failed; null: no payment status at all.
export type LineStatus = 'paid' | 'paidToTaxi' | 'pending' | 'notPaid' | 'failed' | null;

export type SummaryLine = {
  amountCents: number | null;
  // An estimate is labelled "Est."; a final amount isn't.
  isEstimate: boolean;
  status: LineStatus;
};

export type RideSummaryView = {
  fare: SummaryLine;
  share: SummaryLine;
  fee: SummaryLine;
  // Only what was actually paid through FLOQQ.
  totalPaidCents: number;
  // Something will still change: "We'll notify you when your final amount is ready."
  showPendingNote: boolean;
  // The payer: what comes back to them, and whether it was sent.
  payerReturn: { amountCents: number; sent: boolean } | null;
};

const isCaptured = (facts: RideSummaryFacts) => facts.payment?.status === 'CAPTURED' && facts.payment.capturedCents != null;

export function rideSummaryView(facts: RideSummaryFacts): RideSummaryView {
  const receipt = facts.receipt;
  const captured = isCaptured(facts);
  const captureFailed = facts.payment?.status === 'CAPTURE_FAILED';

  // The taxi fare: the receipt's total, or the estimate. With payments off there is never a
  // receipt, so the estimate stays an estimate and nothing is "pending".
  const fare: SummaryLine = receipt
    ? { amountCents: receipt.totalCents, isEstimate: receipt.status === 'ESTIMATED', status: null }
    : {
        amountCents: facts.estimatedTotalCents,
        isEstimate: true,
        status: facts.paymentsEnabled ? 'pending' : null,
      };

  // Your share.
  let share: SummaryLine;
  if (!facts.paymentsEnabled) {
    // Settled among the passengers in the taxi: FLOQQ never charges it, so no status.
    share = { amountCents: facts.estimatedShareCents, isEstimate: true, status: null };
  } else if (facts.isPayer) {
    // The payer paid the driver themselves.
    const own = receipt?.payerShareCents ?? null;
    share = {
      amountCents: own ?? facts.estimatedShareCents,
      isEstimate: own == null || receipt?.status === 'ESTIMATED',
      status: 'paidToTaxi',
    };
  } else if (captured) {
    const shareCents = Math.max(0, (facts.payment!.capturedCents as number) - facts.platformFeeCents);
    share = { amountCents: shareCents, isEstimate: receipt?.status === 'ESTIMATED', status: 'paid' };
  } else {
    const finalShare = receipt ? (facts.payment?.finalShareCents ?? null) : null;
    share = {
      amountCents: finalShare ?? facts.estimatedShareCents,
      isEstimate: finalShare == null || receipt?.status === 'ESTIMATED',
      status: captureFailed ? 'failed' : 'pending',
    };
  }

  // The FLOQQ fee.
  let feeStatus: LineStatus;
  if (facts.paymentsEnabled) {
    feeStatus = captured ? 'paid' : captureFailed ? 'failed' : 'pending';
  } else {
    feeStatus = facts.serviceFeeStatus === 'paid' ? 'paid' : facts.serviceFeeStatus === 'pending' ? 'pending' : 'notPaid';
  }
  const fee: SummaryLine = { amountCents: facts.platformFeeCents, isEstimate: false, status: feeStatus };

  // Total paid through FLOQQ: what was captured from the card (share + fee, or the fee alone for
  // the payer) - or, with payments off, the fee if it was paid.
  const totalPaidCents = facts.paymentsEnabled
    ? captured
      ? (facts.payment!.capturedCents as number)
      : 0
    : feeStatus === 'paid'
      ? facts.platformFeeCents
      : 0;

  const payerReturnCents = facts.isPayer && facts.paymentsEnabled ? (facts.payout?.amountCents ?? receipt?.reimbursementCents ?? null) : null;
  const payerReturn = payerReturnCents != null ? { amountCents: payerReturnCents, sent: facts.payout?.status === 'SENT' } : null;

  const showPendingNote =
    facts.paymentsEnabled && [fare.status, share.status, fee.status].some((status) => status === 'pending');

  return { fare, share, fee, totalPaidCents, showPendingNote, payerReturn };
}

// The reasons a passenger can give for 1 to 4 stars, in the order the chips show them.
export const RATING_REASONS = [
  'finding_group',
  'meeting_point',
  'waiting_time',
  'match_route',
  'fare_price',
  'other_passengers',
  'app',
  'other',
] as const;
export type RatingReason = (typeof RATING_REASONS)[number];

export const RATING_COMMENT_MAX = 500;

// 5 stars: a thank-you. 1 to 4: "What could we do better?".
export const ratingNeedsFollowUp = (stars: number) => stars >= 1 && stars <= 4;

// Admin: ratings of 1 or 2 stars are flagged for review.
export const isFlaggedRating = (stars: number) => stars <= 2;

// Admin: the reasons given most often, most frequent first (ties alphabetically), at most `limit`.
export function topReasons(counts: Record<string, number>, limit: number): { reason: string; count: number }[] {
  return Object.entries(counts)
    .map(([reason, count]) => ({ reason, count: Number(count) }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, limit);
}
