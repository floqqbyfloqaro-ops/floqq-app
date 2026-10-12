// Run with: node --experimental-strip-types --test supabase/functions/_shared/landedRule.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expectedLandingIso, landedPushDue } from './landedRule.ts';

const MINUTE = 60_000;
const ARRIVAL = '2026-10-12T15:00:00Z';
const ARRIVAL_MS = Date.parse(ARRIVAL);
const MAX_LATE = 60;

const ride = (overrides = {}) => ({
  arrival_at: ARRIVAL,
  flight_estimated_arrival_at: null,
  landed_push_sent_at: null,
  ...overrides,
});

test('without flight data a passenger lands at their ride’s arrival time', () => {
  assert.equal(expectedLandingIso(ride()), ARRIVAL);
});

test('with flight data they land at the flight’s estimated landing', () => {
  const delayed = '2026-10-12T16:10:00Z';
  assert.equal(expectedLandingIso(ride({ flight_estimated_arrival_at: delayed })), delayed);
});

test('no notification before the landing', () => {
  assert.equal(landedPushDue(ride(), ARRIVAL_MS - MINUTE, MAX_LATE), false);
});

test('the notification is due from the landing on', () => {
  assert.equal(landedPushDue(ride(), ARRIVAL_MS, MAX_LATE), true);
  assert.equal(landedPushDue(ride(), ARRIVAL_MS + 5 * MINUTE, MAX_LATE), true);
});

test('a delayed flight’s notification waits for the new landing time', () => {
  const delayed = ride({ flight_estimated_arrival_at: '2026-10-12T16:10:00Z' });
  assert.equal(landedPushDue(delayed, ARRIVAL_MS + 5 * MINUTE, MAX_LATE), false);
  assert.equal(landedPushDue(delayed, Date.parse('2026-10-12T16:10:00Z'), MAX_LATE), true);
});

test('it is sent once per ride', () => {
  const sent = ride({ landed_push_sent_at: '2026-10-12T15:00:30Z' });
  assert.equal(landedPushDue(sent, ARRIVAL_MS + 5 * MINUTE, MAX_LATE), false);
});

test('it is not sent for a landing long past', () => {
  assert.equal(landedPushDue(ride(), ARRIVAL_MS + 61 * MINUTE, MAX_LATE), false);
});
