// Run with: node --experimental-strip-types --test supabase/functions/_shared/receiptMath.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isValidReceiptTotal, MAX_RECEIPT_TOTAL_CENTS, settleReceipt } from './receiptMath.ts';
import type { ReceiptMember } from './receiptMath.ts';

const FEE = 249;

// Three passengers, the payer (c) gets off last. Holds sized for a EUR 45 estimate.
function group(holds: [number | null, number | null, number | null]): ReceiptMember[] {
  return [
    { id: 'a', distanceKm: 5, holdAmountCents: holds[0], platformFeeCents: FEE },
    { id: 'b', distanceKm: 10, holdAmountCents: holds[1], platformFeeCents: FEE },
    { id: 'c', distanceKm: 15, holdAmountCents: holds[2], platformFeeCents: FEE },
  ];
}

test('shares come from the existing distance-proportional split and add up to the total', () => {
  const result = settleReceipt(group([2000, 2500, 3000]), 'c', 4500);
  const byId = new Map(result.shares.map((s) => [s.id, s]));
  assert.equal(byId.get('a')!.receiptShareCents, 750);
  assert.equal(byId.get('b')!.receiptShareCents, 1500);
  assert.equal(byId.get('c')!.receiptShareCents, 2250);
  assert.equal(result.shares.reduce((sum, s) => sum + s.receiptShareCents, 0), 4500);
});

test('rounding leftovers still add up to the exact total', () => {
  const members: ReceiptMember[] = [
    { id: 'a', distanceKm: 3.3, holdAmountCents: 5000, platformFeeCents: FEE },
    { id: 'b', distanceKm: 7.1, holdAmountCents: 5000, platformFeeCents: FEE },
    { id: 'c', distanceKm: 11.9, holdAmountCents: 5000, platformFeeCents: FEE },
  ];
  const result = settleReceipt(members, 'c', 4699);
  assert.equal(result.shares.reduce((sum, s) => sum + s.receiptShareCents, 0), 4699);
});

test('the payer is never charged their share - only reimbursed the rest', () => {
  const result = settleReceipt(group([2000, 2500, 3000]), 'c', 4500);
  const payer = result.shares.find((s) => s.id === 'c')!;
  assert.equal(payer.captureShareCents, 0);
  assert.equal(payer.guaranteeCents, 0);
  assert.equal(result.payerShareCents, 2250);
  assert.equal(result.reimbursementCents, 2250);
});

test('holds that cover every share: no guarantee', () => {
  const result = settleReceipt(group([2000, 2500, 3000]), 'c', 4500);
  assert.equal(result.guaranteeCents, 0);
  assert.equal(result.guaranteeUsed, false);
  for (const s of result.shares.filter((s) => s.id !== 'c')) {
    assert.equal(s.captureShareCents, s.receiptShareCents);
  }
});

test('a share above its hold (minus the fee) is capped, and FLOQQ covers the rest', () => {
  // b's share is 1500; hold 1400 - fee 249 = 1151 capturable, so 349 is guaranteed.
  const result = settleReceipt(group([2000, 1400, 3000]), 'c', 4500);
  const b = result.shares.find((s) => s.id === 'b')!;
  assert.equal(b.captureShareCents, 1151);
  assert.equal(b.guaranteeCents, 349);
  assert.equal(result.guaranteeCents, 349);
  assert.equal(result.guaranteeUsed, true);
  // The payer is still reimbursed in full: captures + guarantee = everyone else's shares.
  const captured = result.shares.reduce((sum, s) => sum + s.captureShareCents, 0);
  assert.equal(captured + result.guaranteeCents, result.reimbursementCents);
});

test('a total above the sum of all holds uses the guarantee', () => {
  const result = settleReceipt(group([1000, 1000, 1000]), 'c', 9000);
  assert.ok(9000 > result.holdsTotalCents);
  assert.equal(result.holdsTotalCents, 3000);
  assert.equal(result.guaranteeUsed, true);
  const captured = result.shares.reduce((sum, s) => sum + s.captureShareCents, 0);
  assert.equal(captured, 2 * (1000 - FEE));
  assert.equal(captured + result.guaranteeCents, result.reimbursementCents);
});

test('a passenger without a placed hold is covered in full by the guarantee', () => {
  const result = settleReceipt(group([null, 2500, 3000]), 'c', 4500);
  const a = result.shares.find((s) => s.id === 'a')!;
  assert.equal(a.captureShareCents, 0);
  assert.equal(a.guaranteeCents, 750);
  assert.equal(result.holdsTotalCents, 5500);
});

test('receipt totals must be whole positive cents up to the maximum', () => {
  assert.equal(isValidReceiptTotal(4500), true);
  assert.equal(isValidReceiptTotal(MAX_RECEIPT_TOTAL_CENTS), true);
  assert.equal(isValidReceiptTotal(MAX_RECEIPT_TOTAL_CENTS + 1), false);
  assert.equal(isValidReceiptTotal(0), false);
  assert.equal(isValidReceiptTotal(-100), false);
  assert.equal(isValidReceiptTotal(45.5), false);
});
