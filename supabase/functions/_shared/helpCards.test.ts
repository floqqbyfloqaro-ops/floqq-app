// Run with: node --experimental-strip-types --test supabase/functions/_shared/helpCards.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { paymentCard, parseHelpAction, refundCard, rideCard, rideStatus } from './helpCards.ts';

const payment = (overrides = {}) => ({
  payment_status: 'HOLD_PLACED',
  platform_fee_cents: 249,
  estimated_share_cents: 1800,
  final_share_cents: null,
  hold_amount_cents: 2549,
  captured_cents: null,
  released_cents: null,
  captured_at: null,
  released_at: null,
  isPayer: false,
  ...overrides,
});

test('reserved, not yet charged: fee and share are pending - never "Paid"', () => {
  assert.deepEqual(paymentCard(payment()).lines.map((l) => [l.kind, l.status, l.amountCents]), [
    ['fee', 'pending', 249],
    ['share', 'pending', 1800],
  ]);
  assert.deepEqual(refundCard(payment()), { type: 'refund', amountCents: null, status: 'pending', date: null });
});

test('charged after the ride: both paid, with the real amounts and date; the rest released', () => {
  const charged = payment({ payment_status: 'CAPTURED', final_share_cents: 1650, captured_cents: 1899, released_cents: 650, captured_at: '2026-10-23T18:00:00Z' });
  assert.deepEqual(paymentCard(charged).lines.map((l) => [l.kind, l.status, l.amountCents, l.date]), [
    ['fee', 'paid', 249, '2026-10-23T18:00:00Z'],
    ['share', 'paid', 1650, '2026-10-23T18:00:00Z'],
  ]);
  assert.deepEqual(refundCard(charged), { type: 'refund', amountCents: 650, status: 'released', date: '2026-10-23T18:00:00Z' });
});

test('the payer: own share paid to the taxi, only the fee charged', () => {
  const payer = payment({ payment_status: 'CAPTURED', final_share_cents: 0, captured_cents: 249, released_cents: 2300, isPayer: true, captured_at: 'x' });
  assert.deepEqual(paymentCard(payer).lines.map((l) => l.status), ['paid', 'paid_to_taxi']);
});

test('a late cancellation: only the fee charged, the share released', () => {
  const cancelled = payment({ payment_status: 'CAPTURED', final_share_cents: 0, captured_cents: 249, released_cents: 2300, captured_at: 'x' });
  assert.deepEqual(paymentCard(cancelled).lines.map((l) => l.status), ['paid', 'released']);
});

test('released or refunded: nothing paid; a failed charge says so', () => {
  const released = payment({ payment_status: 'RELEASED', released_cents: 2549, released_at: '2026-10-22T10:00:00Z' });
  assert.deepEqual(paymentCard(released).lines.map((l) => l.status), ['released', 'released']);
  assert.deepEqual(refundCard(released), { type: 'refund', amountCents: 2549, status: 'released', date: '2026-10-22T10:00:00Z' });
  assert.deepEqual(paymentCard(payment({ payment_status: 'REFUNDED', captured_cents: 2049 })).lines.map((l) => l.status), ['refunded', 'refunded']);
  assert.deepEqual(paymentCard(payment({ payment_status: 'CAPTURE_FAILED' })).lines.map((l) => l.status), ['failed', 'failed']);
  assert.equal(refundCard(null).status, 'none');
});

test('the ride card follows the ride through its stages', () => {
  const base = { status: 'matched', destination: 'Gràcia', arrivalAt: '2026-10-23T12:00:00Z', completedAt: null, group: null };
  assert.equal(rideStatus({ ...base, status: 'pending' }), 'searching');
  assert.equal(rideStatus({ ...base, group: { status: 'unconfirmed', meetingTime: null, rideStartedAt: null, meetingPoint: null } }), 'match_found');
  const confirmed = { status: 'confirmed', meetingTime: '2026-10-23T12:30:00Z', rideStartedAt: null, meetingPoint: 'T1-A' };
  assert.deepEqual(rideCard({ ...base, group: confirmed }), { type: 'ride', destination: 'Gràcia', at: '2026-10-23T12:30:00Z', status: 'confirmed', meetingPoint: 'T1-A' });
  assert.equal(rideStatus({ ...base, group: { ...confirmed, rideStartedAt: 'x' } }), 'on_the_way');
  assert.equal(rideStatus({ ...base, completedAt: 'x', group: confirmed }), 'completed');
  assert.equal(rideStatus({ ...base, status: 'cancelled' }), 'cancelled');
});

test('only the known screens can be opened', () => {
  assert.equal(parseHelpAction('cancel_ride'), 'cancel_ride');
  assert.equal(parseHelpAction('refund_now'), null);
});
