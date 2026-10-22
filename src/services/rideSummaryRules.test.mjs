// Run with: node --experimental-strip-types --test src/services/rideSummaryRules.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ratingNeedsFollowUp, rideSummaryView } from './rideSummaryRules.ts';

const base = {
  paymentsEnabled: true,
  isPayer: false,
  platformFeeCents: 249,
  estimatedTotalCents: 7500,
  estimatedShareCents: 2500,
  receipt: null,
  payment: { status: 'HOLD_PLACED', finalShareCents: null, capturedCents: null },
  serviceFeeStatus: 'unpaid',
  payout: null,
};
const view = (overrides) => rideSummaryView({ ...base, ...overrides });
const statuses = (v) => [v.fare.status, v.share.status, v.fee.status];

test('payments off: nothing is "Paid" except a fee that really was paid, and nothing is pending', () => {
  const unpaid = view({ paymentsEnabled: false, payment: null, serviceFeeStatus: 'unpaid' });
  assert.equal(statuses(unpaid).includes('paid'), false);
  assert.deepEqual([unpaid.fare.status, unpaid.share.status], [null, null]);
  assert.equal(unpaid.fare.isEstimate, true);
  assert.equal(unpaid.share.isEstimate, true);
  assert.equal(unpaid.totalPaidCents, 0);
  assert.equal(unpaid.showPendingNote, false);

  const feePaid = view({ paymentsEnabled: false, payment: null, serviceFeeStatus: 'paid' });
  assert.equal(feePaid.fee.status, 'paid');
  assert.equal(feePaid.share.status, null);
  assert.equal(feePaid.totalPaidCents, 249);
});

test('payments on, before the receipt: estimates, everything pending, nothing paid', () => {
  const v = view({});
  assert.deepEqual(statuses(v), ['pending', 'pending', 'pending']);
  assert.equal(v.fare.amountCents, 7500);
  assert.equal(v.share.isEstimate, true);
  assert.equal(v.totalPaidCents, 0);
  assert.equal(v.showPendingNote, true);
});

test('payments on, receipt in but not charged yet: final fare, share still pending', () => {
  const v = view({
    receipt: { status: 'ACCEPTED', totalCents: 8200, payerShareCents: null, reimbursementCents: null },
    payment: { status: 'HOLD_PLACED', finalShareCents: 2700, capturedCents: null },
  });
  assert.deepEqual([v.fare.amountCents, v.fare.isEstimate, v.fare.status], [8200, false, null]);
  assert.deepEqual([v.share.amountCents, v.share.isEstimate, v.share.status], [2700, false, 'pending']);
  assert.equal(v.fee.status, 'pending');
  assert.equal(v.totalPaidCents, 0);
  assert.equal(v.showPendingNote, true);
});

test('payments on, charged: only the captured amount is "Paid" and counted', () => {
  const v = view({
    receipt: { status: 'ACCEPTED', totalCents: 8200, payerShareCents: null, reimbursementCents: null },
    payment: { status: 'CAPTURED', finalShareCents: 2700, capturedCents: 2949 },
  });
  assert.deepEqual([v.share.amountCents, v.share.status], [2700, 'paid']);
  assert.equal(v.fee.status, 'paid');
  assert.equal(v.totalPaidCents, 2949);
  assert.equal(v.showPendingNote, false);
});

test('a failed charge is never "Paid"', () => {
  const v = view({
    receipt: { status: 'ACCEPTED', totalCents: 8200, payerShareCents: null, reimbursementCents: null },
    payment: { status: 'CAPTURE_FAILED', finalShareCents: 2700, capturedCents: null },
  });
  assert.deepEqual([v.share.status, v.fee.status], ['failed', 'failed']);
  assert.equal(v.totalPaidCents, 0);
});

test('no receipt in time: charged on the estimate, labelled "Est."', () => {
  const v = view({
    receipt: { status: 'ESTIMATED', totalCents: 7500, payerShareCents: null, reimbursementCents: null },
    payment: { status: 'CAPTURED', finalShareCents: 2500, capturedCents: 2749 },
  });
  assert.equal(v.fare.isEstimate, true);
  assert.equal(v.share.isEstimate, true);
  assert.equal(v.share.status, 'paid');
});

test('the payer: own share "Paid to the taxi", only the fee charged, money coming back', () => {
  const before = view({ isPayer: true });
  assert.equal(before.share.status, 'paidToTaxi');
  assert.equal(before.payerReturn, null);

  const after = view({
    isPayer: true,
    receipt: { status: 'ACCEPTED', totalCents: 8200, payerShareCents: 3000, reimbursementCents: 5200 },
    payment: { status: 'CAPTURED', finalShareCents: 0, capturedCents: 249 },
    payout: { amountCents: 5200, status: 'SENT' },
  });
  assert.deepEqual([after.share.amountCents, after.share.isEstimate, after.share.status], [3000, false, 'paidToTaxi']);
  assert.equal(after.totalPaidCents, 249);
  assert.deepEqual(after.payerReturn, { amountCents: 5200, sent: true });
});

test('a receipt arriving later turns the estimate into the final amount', () => {
  const before = view({});
  const after = view({ receipt: { status: 'ACCEPTED', totalCents: 8200, payerShareCents: null, reimbursementCents: null } });
  assert.deepEqual([before.fare.amountCents, before.fare.isEstimate, before.fare.status], [7500, true, 'pending']);
  assert.deepEqual([after.fare.amountCents, after.fare.isEstimate, after.fare.status], [8200, false, null]);
});

test('5 stars get a thank-you; 1 to 4 stars ask what could be better', () => {
  assert.equal(ratingNeedsFollowUp(5), false);
  for (const stars of [1, 2, 3, 4]) assert.equal(ratingNeedsFollowUp(stars), true);
});
