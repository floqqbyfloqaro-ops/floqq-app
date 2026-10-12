// Run with: node --experimental-strip-types --test supabase/functions/_shared/airlineTerminalRule.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { airlineCodeOf, airlinesToCheck, airlineTerminal } from './airlineTerminalRule.ts';
import type { AirlineTerminalRow, TerminalMismatch } from './airlineTerminalRule.ts';

const ROWS: AirlineTerminalRow[] = [
  { airline_iata: 'VY', airline_icao: 'VLG', terminal: 'T1' },
  { airline_iata: 'IB', airline_icao: null, terminal: 'T1' },
  { airline_iata: 'U2', airline_icao: 'EZY', terminal: 'T2' },
  { airline_iata: 'FR', airline_icao: 'RYR', terminal: 'T2' },
];

test('the airline is read from a flight number however it is typed', () => {
  assert.equal(airlineCodeOf('VY1234'), 'VY');
  assert.equal(airlineCodeOf('vy 1234'), 'VY');
  assert.equal(airlineCodeOf(' VY-1234 '), 'VY');
  assert.equal(airlineCodeOf('AA40'), 'AA');
});

test('airline codes with a digit are read whole', () => {
  assert.equal(airlineCodeOf('U28055'), 'U2');
  assert.equal(airlineCodeOf('U2 8055'), 'U2');
  assert.equal(airlineCodeOf('W61234'), 'W6');
  assert.equal(airlineCodeOf('3O123'), '3O');
});

test('three-letter airline codes, as some tickets print them, are read too', () => {
  assert.equal(airlineCodeOf('EZY8055'), 'EZY');
  assert.equal(airlineCodeOf('VLG6525'), 'VLG');
});

test('something that is not a flight number has no airline', () => {
  assert.equal(airlineCodeOf(''), null);
  assert.equal(airlineCodeOf('1234'), null);
  assert.equal(airlineCodeOf('VY'), null);
  assert.equal(airlineCodeOf('VUELING'), null);
  assert.equal(airlineCodeOf('VY12345'), null);
});

test('the terminal comes from the airline of the flight number', () => {
  assert.equal(airlineTerminal(ROWS, [null, airlineCodeOf('VY1234')])?.terminal, 'T1');
  assert.equal(airlineTerminal(ROWS, [null, airlineCodeOf('FR5271')])?.terminal, 'T2');
});

test('a three-letter code finds the same airline', () => {
  assert.equal(airlineTerminal(ROWS, [airlineCodeOf('EZY8055')])?.airline_iata, 'U2');
});

test('on a codeshare the operating airline decides, not the flight number', () => {
  const rows: AirlineTerminalRow[] = [...ROWS, { airline_iata: 'XX', airline_icao: null, terminal: 'T2' }];
  assert.equal(airlineTerminal(rows, ['VY', airlineCodeOf('XX5567')])?.terminal, 'T1');
});

test('an operating airline the table does not know falls back to the flight number', () => {
  assert.equal(airlineTerminal(ROWS, ['NI', airlineCodeOf('IB1030')])?.airline_iata, 'IB');
});

test('an unknown airline has no terminal', () => {
  assert.equal(airlineTerminal(ROWS, [null, airlineCodeOf('ZZ123')]), null);
  assert.equal(airlineTerminal(ROWS, [null, null, undefined]), null);
});

const NOW = Date.parse('2026-10-12T12:00:00Z');
const DAY = 24 * 3_600_000;
const RULE = { minFlights: 3, windowDays: 30 };

const mismatch = (overrides: Partial<TerminalMismatch> = {}): TerminalMismatch => ({
  airline_iata: 'VY',
  flight_number: 'VY1001',
  flight_date: '2026-10-10',
  reported_terminal: 'T2',
  created_at: new Date(NOW - DAY).toISOString(),
  ...overrides,
});

test('two contradicting flights are not yet a reason to check an airline', () => {
  const found = airlinesToCheck([mismatch(), mismatch({ flight_number: 'VY1002' })], ROWS, NOW, RULE);
  assert.deepEqual(found, []);
});

test('three different contradicting flights are', () => {
  const found = airlinesToCheck(
    [mismatch(), mismatch({ flight_number: 'VY1002' }), mismatch({ flight_date: '2026-10-11' })],
    ROWS,
    NOW,
    RULE
  );
  assert.deepEqual(found, [{ airline_iata: 'VY', reported_terminal: 'T2', flights: 3 }]);
});

test('the same flight on the same day counts once', () => {
  const found = airlinesToCheck([mismatch(), mismatch(), mismatch()], ROWS, NOW, RULE);
  assert.deepEqual(found, []);
});

test('contradictions older than the window no longer count', () => {
  const old = new Date(NOW - 31 * DAY).toISOString();
  const found = airlinesToCheck(
    [mismatch(), mismatch({ flight_number: 'VY1002' }), mismatch({ flight_number: 'VY1003', created_at: old })],
    ROWS,
    NOW,
    RULE
  );
  assert.deepEqual(found, []);
});

test('the warning is gone once the table says what the flight data said', () => {
  const corrected = ROWS.map((row) => (row.airline_iata === 'VY' ? { ...row, terminal: 'T2' as const } : row));
  const found = airlinesToCheck(
    [mismatch(), mismatch({ flight_number: 'VY1002' }), mismatch({ flight_number: 'VY1003' })],
    corrected,
    NOW,
    RULE
  );
  assert.deepEqual(found, []);
});

test('an airline removed from the table is not warned about', () => {
  const found = airlinesToCheck(
    [
      mismatch({ airline_iata: 'ZZ' }),
      mismatch({ airline_iata: 'ZZ', flight_number: 'ZZ2' }),
      mismatch({ airline_iata: 'ZZ', flight_number: 'ZZ3' }),
    ],
    ROWS,
    NOW,
    RULE
  );
  assert.deepEqual(found, []);
});
