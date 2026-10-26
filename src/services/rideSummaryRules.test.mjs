// Run with: node --experimental-strip-types --test src/services/rideSummaryRules.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isFlaggedRating, ratingNeedsFollowUp, rideSummaryView, topReasons } from './rideSummaryRules.ts';

const base = {
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

test('no reservation: nothing is "Paid"', () => {
  const v = view({ payment: null });
  assert.equal(statuses(v).includes('paid'), false);
  assert.equal(v.totalPaidCents, 0);
});

test('an older ride whose fee was paid on its own: only the fee is "Paid"', () => {
  const v = view({ payment: null, serviceFeeStatus: 'paid' });
  assert.equal(v.fee.status, 'paid');
  assert.notEqual(v.share.status, 'paid');
  assert.equal(v.totalPaidCents, 249);
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

test('"Ride completed" texts exist in every language, spelled FLOQQ', async () => {
  const { readFileSync } = await import('node:fs');
  for (const language of ['en', 'fr', 'es']) {
    const texts = JSON.parse(readFileSync(new URL(`../i18n/locales/${language}.json`, import.meta.url), 'utf8'));
    for (const key of ['ive_arrived', 'ride_completed_title', 'ride_completed_subtitle', 'final_amount_pending', 'rate_experience', 'rating_improve_title']) {
      assert.equal(typeof texts[key], 'string', `${language}: ${key}`);
    }
    assert.match(texts.ride_completed_subtitle, /FLOQQ/, language);
    assert.doesNotMatch(texts.ride_completed_subtitle, /Floq\b/, language);
    assert.equal(Object.keys(texts.ratingReasons).length, 8, language);
  }
});

test('admin: 1-2 stars are flagged; reasons are listed most frequent first', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(isFlaggedRating), [true, true, false, false, false]);
  assert.deepEqual(topReasons({ app: 2, meeting_point: 5, waiting_time: 2, other: 1 }, 3), [
    { reason: 'meeting_point', count: 5 },
    { reason: 'app', count: 2 },
    { reason: 'waiting_time', count: 2 },
  ]);
});
