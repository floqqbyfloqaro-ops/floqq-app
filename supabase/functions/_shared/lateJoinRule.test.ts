// Run with: node --experimental-strip-types --test supabase/functions/_shared/lateJoinRule.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SuggestionLike } from './groupRebalance.ts';
import { joinRejection } from './lateJoinRule.ts';
import type { JoinMember } from './lateJoinRule.ts';

const MAX_LARGE_LUGGAGE = 4;
const DETOUR_LIMITS = { maxMinutes: 15, maxPercent: 50, minAllowedMinutes: 5 };

const passenger = (id: string, overrides: Partial<JoinMember> = {}): JoinMember => ({
  id,
  arrivalAt: '2026-10-09T12:00:00Z',
  largeLuggageCount: 1,
  maxWaitMinutes: 15,
  ...overrides,
});

function scored(fares: Record<string, number>, overrides: Record<string, Partial<SuggestionLike['members'][number]>> = {}) {
  const members = Object.entries(fares).map(([id, fareAmount]) => ({
    id,
    extraDetourMinutes: 3,
    directMinutes: 25,
    waitingMinutes: 10,
    distanceKm: 12,
    fareAmount,
    individualScore: 1,
    ...overrides[id],
  }));
  return { members, worstIndividualScore: 1, totalRouteDistanceKm: 20, totalRouteDurationMinutes: 35 } satisfies SuggestionLike;
}

const existing = [passenger('a'), passenger('b')];
const currentShares = new Map([
  ['a', 1900],
  ['b', 2100],
]);

test('may join: every rule holds and both existing shares go down', () => {
  const suggestion = scored({ a: 14, b: 15.5, c: 16 });
  assert.equal(joinRejection(suggestion, existing, passenger('c'), currentShares, MAX_LARGE_LUGGAGE, DETOUR_LIMITS), null);
});

test('may join: a share that stays exactly the same is fine', () => {
  const suggestion = scored({ a: 19, b: 15.5, c: 16 });
  assert.equal(joinRejection(suggestion, existing, passenger('c'), currentShares, MAX_LARGE_LUGGAGE, DETOUR_LIMITS), null);
});

test('refused: an existing passenger would pay more', () => {
  const suggestion = scored({ a: 19.5, b: 15.5, c: 16 });
  assert.deepEqual(joinRejection(suggestion, existing, passenger('c'), currentShares, MAX_LARGE_LUGGAGE, DETOUR_LIMITS), {
    reason: 'share_would_rise',
    request_id: 'a',
    current_cents: 1900,
    new_cents: 1950,
  });
});

test('refused: the newcomer lands too far apart from someone in the group', () => {
  const late = passenger('c', { arrivalAt: '2026-10-09T12:20:00Z' });
  const suggestion = scored({ a: 14, b: 15.5, c: 16 });
  assert.deepEqual(joinRejection(suggestion, existing, late, currentShares, MAX_LARGE_LUGGAGE, DETOUR_LIMITS), {
    reason: 'arrival_window',
    request_id: 'a',
  });
});

test('refused: an existing passenger would get too long a detour', () => {
  const suggestion = scored({ a: 14, b: 15.5, c: 16 }, { b: { extraDetourMinutes: 14, directMinutes: 20 } });
  assert.deepEqual(joinRejection(suggestion, existing, passenger('c'), currentShares, MAX_LARGE_LUGGAGE, DETOUR_LIMITS), {
    reason: 'detour_over_limit',
    request_id: 'b',
    detour_minutes: 14,
    allowed_minutes: 10,
  });
});

test('refused: the route could not be computed', () => {
  assert.deepEqual(joinRejection(null, existing, passenger('c'), currentShares, MAX_LARGE_LUGGAGE, DETOUR_LIMITS), {
    reason: 'route_lookup_failed',
  });
});

test('hand luggage never blocks a join: only large luggage is counted', () => {
  const suggestion = scored({ a: 14, b: 15.5, c: 16 });
  // Three passengers with one large piece each: 3 of the 4 allowed.
  assert.equal(joinRejection(suggestion, existing, passenger('c'), currentShares, MAX_LARGE_LUGGAGE, DETOUR_LIMITS), null);
  assert.deepEqual(joinRejection(suggestion, existing, passenger('c'), currentShares, 2, DETOUR_LIMITS), {
    reason: 'too_much_large_luggage',
    total_large_luggage: 3,
    max_large_luggage: 2,
  });
});
