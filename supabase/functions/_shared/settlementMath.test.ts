// Run with: node --experimental-strip-types --test supabase/functions/_shared/settlementMath.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CAPTURE_BEFORE_HOLD_EXPIRY_MINUTES, capturePlan, payoutPlan, settleAfterMs } from './settlementMath.ts';

const HOUR = 60 * 60_000;
const ACCEPTED = new Date('2026-10-01T12:00:00Z').getTime();

test('cards are charged when the dispute window ends', () => {
  assert.equal(settleAfterMs(ACCEPTED, 2, null), ACCEPTED + 2 * HOUR);
  assert.equal(settleAfterMs(ACCEPTED, 2, ACCEPTED + 7 * 24 * HOUR), ACCEPTED + 2 * HOUR);
});

test('a hold that expires during the window is captured before it expires', () => {
  const expiry = ACCEPTED + 90 * 60_000;
  assert.equal(settleAfterMs(ACCEPTED, 2, expiry), expiry - CAPTURE_BEFORE_HOLD_EXPIRY_MINUTES * 60_000);
});

test('a hold that is about to expire is captured right away, never in the past', () => {
  assert.equal(settleAfterMs(ACCEPTED, 2, ACCEPTED + 10 * 60_000), ACCEPTED);
});

test('a passenger pays their share plus the fee, the rest of the hold is released', () => {
  // Share 12.80, fee 2.49, hold 12.80 + 2.49 + 5.00 buffer.
  assert.deepEqual(capturePlan({ holdAmountCents: 2029, platformFeeCents: 249, captureShareCents: 1280 }), {
    captureCents: 1529,
    releasedCents: 500,
  });
});

test('the payer only pays the fee from their hold', () => {
  assert.deepEqual(capturePlan({ holdAmountCents: 2029, platformFeeCents: 249, captureShareCents: 0 }), {
    captureCents: 249,
    releasedCents: 1780,
  });
});

test('never captures more than was held', () => {
  assert.deepEqual(capturePlan({ holdAmountCents: 1500, platformFeeCents: 249, captureShareCents: 5000 }), {
    captureCents: 1500,
    releasedCents: 0,
  });
});

test('the payer gets the others’ captured shares; nothing from FLOQQ when they cover it', () => {
  const plan = payoutPlan(2580, [
    { id: 'a', shareCents: 1280 },
    { id: 'b', shareCents: 1300 },
  ]);
  assert.equal(plan.fromCapturesCents, 2580);
  assert.equal(plan.guaranteeCents, 0);
  assert.equal(plan.fromCaptures.length, 2);
});

test('FLOQQ covers what the captures do not (guarantee or a failed capture)', () => {
  const plan = payoutPlan(2580, [
    { id: 'a', shareCents: 1280 },
    { id: 'b', shareCents: 0 },
  ]);
  assert.deepEqual(
    plan.fromCaptures.map((c) => c.id),
    ['a']
  );
  assert.equal(plan.fromCapturesCents, 1280);
  assert.equal(plan.guaranteeCents, 1300);
  assert.equal(plan.fromCapturesCents + plan.guaranteeCents, 2580);
});
