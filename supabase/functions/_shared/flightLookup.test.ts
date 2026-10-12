// Run with: node --experimental-strip-types --test supabase/functions/_shared/flightLookup.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { airportDayKey, flightSnapshot, formCacheMaxAgeMs, pickBestFlight } from './flightLookup.ts';

const HOUR = 3_600_000;
const MINUTE = 60_000;

// As FlightAware returned it for a Barcelona arrival on 2026-10-12 (only the fields the app reads).
const flight = (overrides: Record<string, unknown> = {}) => ({
  ident_iata: 'VY6525',
  operator: 'VLG',
  operator_iata: 'VY',
  origin: { code_iata: 'BLQ', code_icao: 'LIPE' },
  destination: { code_iata: 'BCN' },
  scheduled_out: '2026-10-12T06:55:00Z',
  scheduled_in: '2026-10-12T08:45:00Z',
  terminal_destination: '1',
  ...overrides,
});

const ANCHOR = Date.parse('2026-10-12T09:00:00Z');

test('the terminal and the operating airline are read from the flight data', () => {
  const snapshot = flightSnapshot(flight(), ANCHOR);
  assert.equal(snapshot.terminal, 'T1');
  assert.equal(snapshot.operatorIata, 'VY');
  assert.equal(snapshot.onExpectedDay, true);
});

test('the origin airport is read from the flight data', () => {
  const snapshot = flightSnapshot(flight(), ANCHOR);
  assert.equal(snapshot.originIata, 'BLQ');
  assert.equal(snapshot.originIcao, 'LIPE');
});

test('flight data without a usable origin has none', () => {
  const snapshot = flightSnapshot(flight({ origin: { code_iata: null, code_icao: 'XX' } }), ANCHOR);
  assert.equal(snapshot.originIata, null);
  assert.equal(snapshot.originIcao, null);
});

test('the arrival time is the gate arrival, never the runway landing', () => {
  const landedNotAtGate = flight({ scheduled_on: '2026-10-12T08:38:00Z', actual_on: '2026-10-12T08:36:00Z', scheduled_in: '2026-10-12T08:45:00Z' });
  assert.equal(flightSnapshot(landedNotAtGate, ANCHOR).estimatedLanding, '2026-10-12T08:45:00Z');
  const atGate = flight({ actual_on: '2026-10-12T08:36:00Z', actual_in: '2026-10-12T08:43:00Z' });
  assert.equal(flightSnapshot(atGate, ANCHOR).estimatedLanding, '2026-10-12T08:43:00Z');
  const runwayOnly = flight({ scheduled_in: null, scheduled_on: '2026-10-12T08:38:00Z' });
  assert.equal(flightSnapshot(runwayOnly, ANCHOR).estimatedLanding, null);
});

test('a flight without a terminal yet has none', () => {
  assert.equal(flightSnapshot(flight({ terminal_destination: null }), ANCHOR).terminal, null);
});

test('a terminal at another airport is not this ride’s terminal', () => {
  assert.equal(flightSnapshot(flight({ destination: { code_iata: 'MAD' } }), ANCHOR).terminal, null);
});

test('flight data without an operating airline has none', () => {
  assert.equal(flightSnapshot(flight({ operator_iata: null }), ANCHOR).operatorIata, null);
});

test('another day’s flight under the same number is not the expected one', () => {
  const twoWeeksAhead = ANCHOR + 14 * 24 * HOUR;
  const picked = pickBestFlight([flight()], twoWeeksAhead);
  assert.equal(flightSnapshot(picked, twoWeeksAhead).onExpectedDay, false);
});

test('the day is the airport’s, not UTC’s', () => {
  // 22:30 UTC on the 12th is 00:30 on the 13th in Barcelona.
  assert.equal(airportDayKey(Date.parse('2026-10-12T22:30:00Z')), '2026-10-13');
  const lateLanding = flight({ scheduled_in: '2026-10-12T22:30:00Z' });
  assert.equal(flightSnapshot(lateLanding, Date.parse('2026-10-13T08:00:00Z')).onExpectedDay, true);
});

test('a landing just past midnight still matches an arrival entered for late the evening before', () => {
  const pastMidnight = flight({ scheduled_in: '2026-10-12T22:30:00Z' });
  assert.equal(flightSnapshot(pastMidnight, Date.parse('2026-10-12T21:00:00Z')).onExpectedDay, true);
});

test('a kept lookup is reused for half an hour when the flight lands soon', () => {
  const now = ANCHOR - 5 * HOUR;
  assert.equal(formCacheMaxAgeMs(ANCHOR, now), 30 * MINUTE);
});

test('and for a day when the flight is further away', () => {
  const now = ANCHOR - 5 * 24 * HOUR;
  assert.equal(formCacheMaxAgeMs(ANCHOR, now), 24 * HOUR);
});
