// Run with: node --experimental-strip-types --test supabase/functions/_shared/matchRejectionRule.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRejectionMemory, rejectionFingerprint, rejectionKey } from './matchRejectionRule.ts';

const MINUTE = 60_000;
const NOW = Date.parse('2026-10-12T12:00:00Z');
const RECHECK_MINUTES = 5;

const member = (id: string, overrides = {}) => ({
  id,
  arrival_at: '2026-10-13T15:00:00Z',
  destination_lat: 41.39,
  destination_lng: 2.17,
  large_luggage_count: 1,
  max_wait_minutes: 15,
  ...overrides,
});

const A = member('a');
const B = member('b', { destination_lat: 41.4 });
const KEY = rejectionKey('new', ['a', 'b']);
const PRINT = rejectionFingerprint([A, B]);

const rejectedAgo = (minutes: number) => [
  { group_key: KEY, fingerprint: PRINT, rejected_at: new Date(NOW - minutes * MINUTE).toISOString() },
];

test('the same passengers in any order are the same combination', () => {
  assert.equal(rejectionKey('new', ['b', 'a']), KEY);
  assert.equal(rejectionFingerprint([B, A]), PRINT);
});

test('a new group and joining an offer are remembered apart', () => {
  assert.notEqual(rejectionKey('join', ['a', 'b']), KEY);
});

test('a combination nobody turned down is asked about', () => {
  const memory = createRejectionMemory([], NOW, RECHECK_MINUTES);
  assert.equal(memory.isRejected(KEY, PRINT), false);
});

test('a combination turned down a minute ago is not asked about again', () => {
  const memory = createRejectionMemory(rejectedAgo(1), NOW, RECHECK_MINUTES);
  assert.equal(memory.isRejected(KEY, PRINT), true);
});

test('it is asked about again after the recheck time (traffic may have changed)', () => {
  const memory = createRejectionMemory(rejectedAgo(5), NOW, RECHECK_MINUTES);
  assert.equal(memory.isRejected(KEY, PRINT), false);
});

test('it is asked about again at once when a member changed their ride', () => {
  const memory = createRejectionMemory(rejectedAgo(1), NOW, RECHECK_MINUTES);
  const laterArrival = rejectionFingerprint([A, member('b', { destination_lat: 41.4, arrival_at: '2026-10-13T15:20:00Z' })]);
  const otherDestination = rejectionFingerprint([A, member('b', { destination_lat: 41.45 })]);
  assert.equal(memory.isRejected(KEY, laterArrival), false);
  assert.equal(memory.isRejected(KEY, otherDestination), false);
});

test('joining an offer is asked about again when the offer changed', () => {
  const key = rejectionKey('join', ['a', 'b']);
  const before = rejectionFingerprint([A, B], 'v3|3800');
  const memory = createRejectionMemory(
    [{ group_key: key, fingerprint: before, rejected_at: new Date(NOW - MINUTE).toISOString() }],
    NOW,
    RECHECK_MINUTES
  );
  assert.equal(memory.isRejected(key, before), true);
  assert.equal(memory.isRejected(key, rejectionFingerprint([A, B], 'v4|3800')), false);
});

test('a rejection made in this run counts at once and is handed back for storing', () => {
  const memory = createRejectionMemory([], NOW, RECHECK_MINUTES);
  memory.reject(KEY, PRINT);
  assert.equal(memory.isRejected(KEY, PRINT), true);
  assert.deepEqual(memory.added(), [{ group_key: KEY, fingerprint: PRINT, rejected_at: new Date(NOW).toISOString() }]);
});

test('nothing is stored when nothing was turned down', () => {
  const memory = createRejectionMemory(rejectedAgo(1), NOW, RECHECK_MINUTES);
  assert.deepEqual(memory.added(), []);
});
