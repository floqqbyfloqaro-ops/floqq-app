// Pure settlement rules for the payments prototype's taxi receipt (phase 5). No Deno or network
// imports, so it runs under the plain Node test in receiptMath.test.ts. All amounts are integer
// cents, EUR.
//
// The payer pays the whole taxi total T and keeps their own share of it. Everyone else's share
// is captured from their seat reservation (card hold) together with the platform fee, and goes
// back to the payer. Stripe can never capture more than was held, so whatever part of a share
// its hold can't cover is paid by FLOQQ instead - the Ride Payment Guarantee - so the payer
// always gets T minus their own share back in full.

import { calculateFareSplit } from './fareSplit.ts';

// Anything above this is almost certainly a typo (a BCN airport taxi is well under EUR 150).
export const MAX_RECEIPT_TOTAL_CENTS = 50_000;

export type ReceiptMember = {
  id: string;
  distanceKm: number;
  // The placed hold, or null if this passenger has no hold that can be captured.
  holdAmountCents: number | null;
  platformFeeCents: number;
};

export type ReceiptShare = {
  id: string;
  // This passenger's part of the real taxi total, from the existing distance-proportional split.
  receiptShareCents: number;
  // The part of that share to capture from their hold (on top of the platform fee). Always 0 for
  // the payer, who paid the taxi directly.
  captureShareCents: number;
  // The part of that share FLOQQ covers because the hold is too small.
  guaranteeCents: number;
};

export type ReceiptSettlement = {
  shares: ReceiptShare[];
  payerShareCents: number;
  // What the payer gets back: the taxi total minus their own share.
  reimbursementCents: number;
  // Sum of every member's placed hold (fees and buffers included), for the admin's overview.
  holdsTotalCents: number;
  guaranteeCents: number;
  guaranteeUsed: boolean;
};

export function isValidReceiptTotal(totalCents: number): boolean {
  return Number.isInteger(totalCents) && totalCents > 0 && totalCents <= MAX_RECEIPT_TOTAL_CENTS;
}

export function settleReceipt(members: ReceiptMember[], payerId: string, totalCents: number): ReceiptSettlement {
  const split = calculateFareSplit(
    members.map((m) => ({ id: m.id, distanceKm: m.distanceKm })),
    totalCents / 100
  );
  const shareById = new Map(split.map((s) => [s.id, Math.round(s.amount * 100)]));

  const shares = members.map((m): ReceiptShare => {
    const receiptShareCents = shareById.get(m.id) ?? 0;
    if (m.id === payerId) {
      return { id: m.id, receiptShareCents, captureShareCents: 0, guaranteeCents: 0 };
    }
    const capturable = m.holdAmountCents == null ? 0 : Math.max(0, m.holdAmountCents - m.platformFeeCents);
    const captureShareCents = Math.min(receiptShareCents, capturable);
    return { id: m.id, receiptShareCents, captureShareCents, guaranteeCents: receiptShareCents - captureShareCents };
  });

  const payerShareCents = shareById.get(payerId) ?? 0;
  const guaranteeCents = shares.reduce((sum, s) => sum + s.guaranteeCents, 0);

  return {
    shares,
    payerShareCents,
    reimbursementCents: totalCents - payerShareCents,
    holdsTotalCents: members.reduce((sum, m) => sum + (m.holdAmountCents ?? 0), 0),
    guaranteeCents,
    guaranteeUsed: guaranteeCents > 0,
  };
}
