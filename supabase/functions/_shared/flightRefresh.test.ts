// Run with: node --experimental-strip-types --test supabase/functions/_shared/flightRefresh.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FLIGHT_REFRESH_SCHEDULE } from './constants.ts';
import { isFlightCheckDue } from './flightRefresh.ts';
import type { FlightCheckState } from './flightRefresh.ts';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const SCHEDULE = { checkpointHours: [48, 24, 6, 2], inFlightMinutes: 10, giveUpHours: 6 };

// A flight landing at ARRIVAL that leaves three hours earlier.
const ARRIVAL = Date.parse('2026-10-12T12:00:00Z');
const DEPARTURE = ARRIVAL - 3 * HOUR;

const due = (nowMs: number, overrides: Partial<FlightCheckState> = {}) =>
  isFlightCheckDue(
    { arrivalAtMs: ARRIVAL, lastCheckedAtMs: null, scheduledDepartureMs: DEPARTURE, landed: false, ...overrides },
    nowMs,
    SCHEDULE
  );

test('the shipped schedule is the agreed one', () => {
  assert.deepEqual([...FLIGHT_REFRESH_SCHEDULE.checkpointHours], [48, 24, 6, 2]);
  assert.equal(FLIGHT_REFRESH_SCHEDULE.inFlightMinutes, 10);
  assert.equal(FLIGHT_REFRESH_SCHEDULE.giveUpHours, 6);
});

test('nothing is looked up earlier than 48 hours before landing', () => {
  assert.equal(due(ARRIVAL - 72 * HOUR), false);
  assert.equal(due(ARRIVAL - 48 * HOUR - MINUTE), false);
});

test('the first lookup is due as soon as the 48-hour checkpoint is reached', () => {
  assert.equal(due(ARRIVAL - 48 * HOUR), true);
});

test('a ride booked inside the window is looked up right away', () => {
  assert.equal(due(ARRIVAL - 30 * HOUR), true);
  assert.equal(due(ARRIVAL - 5 * HOUR), true);
});

test('each checkpoint is looked up once, not again until the next one', () => {
  const checkedAt48 = { lastCheckedAtMs: ARRIVAL - 48 * HOUR + MINUTE };
  assert.equal(due(ARRIVAL - 47 * HOUR, checkedAt48), false);
  assert.equal(due(ARRIVAL - 25 * HOUR, checkedAt48), false);
  assert.equal(due(ARRIVAL - 24 * HOUR, checkedAt48), true);

  const checkedAt24 = { lastCheckedAtMs: ARRIVAL - 24 * HOUR + MINUTE };
  assert.equal(due(ARRIVAL - 10 * HOUR, checkedAt24), false);
  assert.equal(due(ARRIVAL - 6 * HOUR, checkedAt24), true);
});

test('a missed checkpoint is caught up once, not once per checkpoint missed', () => {
  // Last looked up 40 h before landing; the job was down across the 24 h and 6 h checkpoints.
  const state = { lastCheckedAtMs: ARRIVAL - 40 * HOUR };
  assert.equal(due(ARRIVAL - 5 * HOUR, state), true);
  assert.equal(due(ARRIVAL - 5 * HOUR + MINUTE, { lastCheckedAtMs: ARRIVAL - 5 * HOUR }), false);
});

test('from the scheduled departure on, the flight is looked up about every 10 minutes', () => {
  const justChecked = DEPARTURE + 30 * MINUTE;
  assert.equal(due(justChecked + 4 * MINUTE, { lastCheckedAtMs: justChecked }), false);
  assert.equal(due(justChecked + 8 * MINUTE, { lastCheckedAtMs: justChecked }), false);
  assert.equal(due(justChecked + 10 * MINUTE, { lastCheckedAtMs: justChecked }), true);
});

test('a job tick that lands a few seconds early still counts as 10 minutes', () => {
  const justChecked = DEPARTURE + 30 * MINUTE;
  assert.equal(due(justChecked + 10 * MINUTE - 5_000, { lastCheckedAtMs: justChecked }), true);
});

test('the in-flight pace starts at the scheduled departure, whether or not the flight left', () => {
  const checkedBefore = { lastCheckedAtMs: DEPARTURE - 20 * MINUTE };
  assert.equal(due(DEPARTURE - 5 * MINUTE, checkedBefore), false);
  assert.equal(due(DEPARTURE, checkedBefore), true);
});

test('without a known departure, the last checkpoint stands in for it', () => {
  const state = { scheduledDepartureMs: null, lastCheckedAtMs: ARRIVAL - 2 * HOUR - 30 * MINUTE };
  assert.equal(due(ARRIVAL - 2 * HOUR - 15 * MINUTE, state), false);
  assert.equal(due(ARRIVAL - 2 * HOUR, state), true);
  assert.equal(due(ARRIVAL - HOUR, { scheduledDepartureMs: null, lastCheckedAtMs: ARRIVAL - HOUR - 4 * MINUTE }), false);
});

test('a delayed flight keeps being followed after its expected landing', () => {
  assert.equal(due(ARRIVAL + 2 * HOUR, { lastCheckedAtMs: ARRIVAL + 2 * HOUR - 10 * MINUTE }), true);
});

test('a flight that has landed is never looked up again', () => {
  assert.equal(due(ARRIVAL - HOUR, { landed: true, lastCheckedAtMs: ARRIVAL - 2 * HOUR }), false);
  assert.equal(due(ARRIVAL - 24 * HOUR, { landed: true }), false);
});

test('a flight that never reports landing is dropped 6 hours after it was expected', () => {
  const longAgo = { lastCheckedAtMs: ARRIVAL };
  assert.equal(due(ARRIVAL + 6 * HOUR, longAgo), true);
  assert.equal(due(ARRIVAL + 6 * HOUR + MINUTE, longAgo), false);
});
