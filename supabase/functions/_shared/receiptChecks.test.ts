// Run with: node --experimental-strip-types --test supabase/functions/_shared/receiptChecks.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateReceipt, madridLocalToUtcMs, parseReceiptTotal } from './receiptChecks.ts';
import type { ReceiptScan, RideContext } from './receiptChecks.ts';

const MINUTE = 60_000;

// Flight lands 2026-09-27 14:00 Barcelona (12:00 UTC, summer time); taxi leaves 20 min later.
const ARRIVAL = '2026-09-27T12:00:00Z';
const DEPARTURE_MS = new Date(ARRIVAL).getTime() + 20 * MINUTE;

function scan(overrides: Partial<ReceiptScan> = {}): ReceiptScan {
  return {
    readable: true,
    isTaxiReceipt: true,
    totalEur: '38,50',
    date: '2026-09-27',
    time: '14:55',
    taxiLicence: '1234',
    receiptNumber: '000567',
    ...overrides,
  };
}

function ride(overrides: Partial<RideContext> = {}): RideContext {
  return {
    arrivalTimes: [ARRIVAL, '2026-09-27T11:50:00Z'],
    departureMs: DEPARTURE_MS,
    nowMs: DEPARTURE_MS + 90 * MINUTE,
    estimatedFareCents: 3800,
    duplicateReceipt: false,
    duplicatePhoto: false,
    ...overrides,
  };
}

test('receipt totals in Spanish and English notation', () => {
  assert.equal(parseReceiptTotal('38,50'), 3850);
  assert.equal(parseReceiptTotal('38.50'), 3850);
  assert.equal(parseReceiptTotal('€ 38.5'), 3850);
  assert.equal(parseReceiptTotal('38 EUR'), 3800);
  assert.equal(parseReceiptTotal('1.038,50'), 103850);
  assert.equal(parseReceiptTotal(''), null);
  assert.equal(parseReceiptTotal('abc'), null);
});

test('Barcelona wall-clock time converts with summer and winter offsets', () => {
  assert.equal(madridLocalToUtcMs('2026-09-27', '14:55'), Date.UTC(2026, 8, 27, 12, 55));
  assert.equal(madridLocalToUtcMs('2026-12-01', '09:00'), Date.UTC(2026, 11, 1, 8, 0));
  assert.equal(madridLocalToUtcMs('27/09/2026', '14:55'), null);
  assert.equal(madridLocalToUtcMs('2026-09-27', '25:00'), null);
});

test("a readable receipt from this ride's time window is accepted", () => {
  const verdict = evaluateReceipt(scan(), ride());
  assert.equal(verdict.outcome, 'ACCEPTED');
  if (verdict.outcome === 'UNREADABLE') return;
  assert.equal(verdict.totalCents, 3850);
  assert.deepEqual(verdict.reasons, []);
});

test('an old receipt (earlier date) goes to review', () => {
  const verdict = evaluateReceipt(scan({ date: '2026-08-14', totalEur: '38,50' }), ride());
  assert.equal(verdict.outcome, 'NEEDS_REVIEW');
  if (verdict.outcome === 'UNREADABLE') return;
  assert.deepEqual(verdict.reasons, ['date_outside_ride']);
});

test('a receipt from the same day but hours before anyone landed goes to review', () => {
  const verdict = evaluateReceipt(scan({ time: '08:10' }), ride());
  assert.equal(verdict.outcome, 'NEEDS_REVIEW');
});

test('a receipt dated in the future goes to review', () => {
  const verdict = evaluateReceipt(scan({ date: '2026-09-28' }), ride());
  assert.equal(verdict.outcome, 'NEEDS_REVIEW');
  if (verdict.outcome === 'UNREADABLE') return;
  assert.deepEqual(verdict.reasons, ['date_in_future']);
});

test('no readable date goes to review, never auto-accepted', () => {
  const verdict = evaluateReceipt(scan({ date: '', time: '' }), ride());
  assert.equal(verdict.outcome, 'NEEDS_REVIEW');
  if (verdict.outcome === 'UNREADABLE') return;
  assert.deepEqual(verdict.reasons, ['no_date']);
});

test('a receipt or photo already used for another ride goes to review', () => {
  const verdict = evaluateReceipt(scan(), ride({ duplicateReceipt: true, duplicatePhoto: true }));
  assert.equal(verdict.outcome, 'NEEDS_REVIEW');
  if (verdict.outcome === 'UNREADABLE') return;
  assert.deepEqual(verdict.reasons, ['duplicate_receipt', 'duplicate_photo']);
});

test('an amount far above the estimate goes to review', () => {
  // Limit for a EUR 38 estimate: 57 + 10 = EUR 67.
  assert.equal(evaluateReceipt(scan({ totalEur: '67,00' }), ride()).outcome, 'ACCEPTED');
  const verdict = evaluateReceipt(scan({ totalEur: '67,01' }), ride());
  assert.equal(verdict.outcome, 'NEEDS_REVIEW');
  if (verdict.outcome === 'UNREADABLE') return;
  assert.deepEqual(verdict.reasons, ['amount_above_estimate']);
});

test('unreadable photos, non-receipts and missing totals ask for a new photo', () => {
  assert.deepEqual(evaluateReceipt(scan({ readable: false }), ride()), { outcome: 'UNREADABLE', reason: 'unreadable' });
  assert.deepEqual(evaluateReceipt(scan({ isTaxiReceipt: false }), ride()), {
    outcome: 'UNREADABLE',
    reason: 'not_a_taxi_receipt',
  });
  assert.deepEqual(evaluateReceipt(scan({ totalEur: '' }), ride()), { outcome: 'UNREADABLE', reason: 'no_total' });
  assert.deepEqual(evaluateReceipt(scan({ totalEur: '900,00' }), ride()), { outcome: 'UNREADABLE', reason: 'no_total' });
});
