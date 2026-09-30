// Payments prototype, phase 7: the failure-handling rules.
// Run with: node --experimental-strip-types --test supabase/functions/_shared/failureHandling.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { holdTransition } from './holdMath.ts';
import {
  capturePlan,
  FREE_CANCELLATION_HOURS,
  freeCancelUntilMs,
  missingReceiptStep,
  outstandingCents,
  payoutPlan,
  receiptDeadlineMs,
} from './settlementMath.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const RIDE = new Date('2026-10-01T12:00:00Z').getTime();

// Applies a sequence of Stripe PaymentIntent states the way the webhook does: each event re-reads
// the intent's current state and only moves the row along allowed transitions.
function replay(start: string, intentStates: string[]): string {
  return intentStates.reduce((status, state) => holdTransition(state, status) ?? status, start);
}

// --- 1. A capture fails ---

test('a failed capture: the payer still gets everything, the passenger owes share + fee', () => {
  // Two passengers owe 12.80 and 13.00; b's capture failed.
  const plan = payoutPlan(2580, [
    { id: 'a', shareCents: 1280 },
    { id: 'b', shareCents: 0 },
  ]);
  assert.equal(plan.fromCapturesCents + plan.guaranteeCents, 2580);
  assert.equal(plan.guaranteeCents, 1300);
  assert.equal(outstandingCents({ isPayer: false, finalShareCents: 1300, platformFeeCents: 249 }), 1549);
});

test('a payer whose own hold failed only owes the fee', () => {
  assert.equal(outstandingCents({ isPayer: true, finalShareCents: 0, platformFeeCents: 249 }), 249);
});

// --- 2. A hold expires before capture ---

test('the receipt deadline leaves room to capture before the first hold expires', () => {
  const expiry = RIDE + 20 * HOUR;
  assert.equal(receiptDeadlineMs(RIDE, expiry), RIDE + 16 * HOUR);
  assert.equal(receiptDeadlineMs(RIDE, RIDE + 7 * 24 * HOUR), RIDE + 24 * HOUR);
  assert.equal(receiptDeadlineMs(RIDE, null), RIDE + 24 * HOUR);
});

test('an expired hold is a webhook "canceled": the row is released, never captured afterwards', () => {
  assert.equal(replay('HOLD_PLACED', ['canceled']), 'RELEASED');
  assert.equal(replay('HOLD_PLACED', ['canceled', 'succeeded']), 'RELEASED');
});

// --- 3. Cancelling after confirmation ---

test('cancelling is free until 24 hours before the ride', () => {
  assert.equal(FREE_CANCELLATION_HOURS, 24);
  assert.equal(freeCancelUntilMs(RIDE), RIDE - 24 * HOUR);
});

test('a late cancellation keeps only the fee and releases the rest', () => {
  assert.deepEqual(capturePlan({ holdAmountCents: 2029, platformFeeCents: 249, captureShareCents: 0 }), {
    captureCents: 249,
    releasedCents: 1780,
  });
});

// --- 4. The payer never sends the receipt ---

test('reminder an hour after the ride, final reminder 4 hours before the deadline, then the fallback', () => {
  const deadline = RIDE + 24 * HOUR;
  const none = { reminder: false, finalReminder: false };
  assert.equal(missingReceiptStep(RIDE + 30 * MINUTE, RIDE, deadline, none), 'wait');
  assert.equal(missingReceiptStep(RIDE + HOUR, RIDE, deadline, none), 'reminder');
  assert.equal(missingReceiptStep(RIDE + 5 * HOUR, RIDE, deadline, { reminder: true, finalReminder: false }), 'wait');
  assert.equal(missingReceiptStep(deadline - 4 * HOUR, RIDE, deadline, { reminder: true, finalReminder: false }), 'final_reminder');
  assert.equal(missingReceiptStep(deadline - HOUR, RIDE, deadline, { reminder: true, finalReminder: true }), 'wait');
  assert.equal(missingReceiptStep(deadline, RIDE, deadline, { reminder: true, finalReminder: true }), 'fallback');
});

test('a ride that is already close to its deadline gets one reminder, not two', () => {
  const deadline = RIDE + 5 * HOUR;
  assert.equal(missingReceiptStep(RIDE + 2 * HOUR, RIDE, deadline, { reminder: false, finalReminder: false }), 'final_reminder');
  assert.equal(missingReceiptStep(RIDE + 3 * HOUR, RIDE, deadline, { reminder: true, finalReminder: true }), 'wait');
});

test('the fallback happens even if no reminder could be sent', () => {
  assert.equal(missingReceiptStep(RIDE + 25 * HOUR, RIDE, RIDE + 24 * HOUR, { reminder: false, finalReminder: false }), 'fallback');
});

// --- 5. Webhooks twice or out of order ---

test('the same event twice changes nothing the second time', () => {
  assert.equal(holdTransition('requires_capture', 'HOLD_PLACED'), null);
  assert.equal(replay('NOT_STARTED', ['requires_capture', 'requires_capture']), 'HOLD_PLACED');
});

test('a late "failed" or "needs verification" never undoes a placed hold', () => {
  assert.equal(replay('NOT_STARTED', ['requires_action', 'requires_capture', 'requires_payment_method']), 'HOLD_PLACED');
  assert.equal(replay('NOT_STARTED', ['requires_capture', 'requires_action']), 'HOLD_PLACED');
});

test('nothing moves a captured payment, whatever arrives late', () => {
  for (const state of ['requires_capture', 'requires_action', 'requires_payment_method', 'canceled', 'succeeded']) {
    assert.equal(holdTransition(state, 'CAPTURED'), null, state);
  }
});

test('a capture Stripe confirms before FLOQQ recorded it is picked up from the webhook', () => {
  assert.equal(holdTransition('succeeded', 'HOLD_PLACED'), 'CAPTURED');
  assert.equal(replay('HOLD_PLACED', ['succeeded', 'succeeded', 'requires_capture']), 'CAPTURED');
});

test('a released hold stays released', () => {
  assert.equal(replay('RELEASED', ['requires_capture', 'succeeded', 'canceled']), 'RELEASED');
});

test('a failed hold can still be retried and placed', () => {
  assert.equal(replay('NOT_STARTED', ['requires_payment_method', 'requires_capture']), 'HOLD_PLACED');
});
