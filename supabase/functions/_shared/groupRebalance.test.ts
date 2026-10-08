// Run with: node --experimental-strip-types --test supabase/functions/_shared/groupRebalance.test.ts
// Plain Node test (no Deno, no test framework dependency) - see the note at the top of
// groupRebalance.ts for why this file has no Deno-touching imports.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildGroupTotalsPayload, buildMemberScoresPayload, groupRejection, isGroupStillValid } from './groupRebalance.ts';
import type { SuggestionLike } from './groupRebalance.ts';

const MAX_BAGS = 4;
const DETOUR_LIMITS = { maxMinutes: 15, maxPercent: 50, minAllowedMinutes: 5 };

function member(overrides: Partial<SuggestionLike['members'][number]> & { id: string }) {
  return {
    extraDetourMinutes: 0,
    waitingMinutes: 0,
    distanceKm: 5,
    fareAmount: 10,
    individualScore: 1,
    ...overrides,
  };
}

test('valid group: within detour and each member within their own wait tolerance', () => {
  const suggestion: SuggestionLike = {
    members: [member({ id: 'a', extraDetourMinutes: 5, waitingMinutes: 4 }), member({ id: 'b', extraDetourMinutes: 3, waitingMinutes: 8 })],
    worstIndividualScore: 9,
    totalRouteDistanceKm: 12,
    totalRouteDurationMinutes: 20,
  };
  const remaining = [
    { id: 'a', bagsCount: 1, maxWaitMinutes: 10 },
    { id: 'b', bagsCount: 1, maxWaitMinutes: 10 },
  ];

  assert.equal(isGroupStillValid(suggestion, remaining, MAX_BAGS, DETOUR_LIMITS), true);
});

test('invalid: a member now exceeds MAX_DETOUR_MINUTES', () => {
  const suggestion: SuggestionLike = {
    members: [member({ id: 'a', extraDetourMinutes: 20 }), member({ id: 'b' })],
    worstIndividualScore: 20,
    totalRouteDistanceKm: 12,
    totalRouteDurationMinutes: 20,
  };
  const remaining = [
    { id: 'a', bagsCount: 1, maxWaitMinutes: 10 },
    { id: 'b', bagsCount: 1, maxWaitMinutes: 10 },
  ];

  assert.equal(isGroupStillValid(suggestion, remaining, MAX_BAGS, DETOUR_LIMITS), false);
});

test('invalid: a member is within 15 min but over 50% of their own short direct trip', () => {
  const suggestion: SuggestionLike = {
    members: [member({ id: 'a', extraDetourMinutes: 9, directMinutes: 15 }), member({ id: 'b', directMinutes: 30 })],
    worstIndividualScore: 9,
    totalRouteDistanceKm: 12,
    totalRouteDurationMinutes: 24,
  };
  const remaining = [
    { id: 'a', bagsCount: 1, maxWaitMinutes: 10 },
    { id: 'b', bagsCount: 1, maxWaitMinutes: 10 },
  ];

  assert.equal(isGroupStillValid(suggestion, remaining, MAX_BAGS, DETOUR_LIMITS), false);
});

test('invalid: a member now waits longer than their own max_wait_minutes', () => {
  const suggestion: SuggestionLike = {
    members: [member({ id: 'a', waitingMinutes: 25 }), member({ id: 'b' })],
    worstIndividualScore: 5,
    totalRouteDistanceKm: 12,
    totalRouteDurationMinutes: 20,
  };
  const remaining = [
    { id: 'a', bagsCount: 1, maxWaitMinutes: 15 },
    { id: 'b', bagsCount: 1, maxWaitMinutes: 15 },
  ];

  assert.equal(isGroupStillValid(suggestion, remaining, MAX_BAGS, DETOUR_LIMITS), false);
});

test('invalid: combined luggage now exceeds taxi capacity', () => {
  const suggestion: SuggestionLike = {
    members: [member({ id: 'a' }), member({ id: 'b' })],
    worstIndividualScore: 5,
    totalRouteDistanceKm: 12,
    totalRouteDurationMinutes: 20,
  };
  const remaining = [
    { id: 'a', bagsCount: 3, maxWaitMinutes: 15 },
    { id: 'b', bagsCount: 3, maxWaitMinutes: 15 },
  ];

  assert.equal(isGroupStillValid(suggestion, remaining, MAX_BAGS, DETOUR_LIMITS), false);
});

test('invalid: route recomputation failed (null suggestion)', () => {
  const remaining = [{ id: 'a', bagsCount: 1, maxWaitMinutes: 15 }];
  assert.equal(isGroupStillValid(null, remaining, MAX_BAGS, DETOUR_LIMITS), false);
});

test('buildMemberScoresPayload maps to the snake_case shape apply_group_rescore expects', () => {
  const suggestion: SuggestionLike = {
    members: [member({ id: 'a', distanceKm: 7.5, extraDetourMinutes: 2, waitingMinutes: 3, individualScore: 11 })],
    worstIndividualScore: 11,
    totalRouteDistanceKm: 7.5,
    totalRouteDurationMinutes: 15,
  };

  assert.deepEqual(buildMemberScoresPayload(suggestion), [
    { id: 'a', distance_km: 7.5, extra_detour_minutes: 2, waiting_minutes: 3, individual_score: 11 },
  ]);
});

test('buildGroupTotalsPayload sums fare across members', () => {
  const suggestion: SuggestionLike = {
    members: [member({ id: 'a', fareAmount: 6 }), member({ id: 'b', fareAmount: 9 })],
    worstIndividualScore: 3,
    totalRouteDistanceKm: 20,
    totalRouteDurationMinutes: 30,
  };

  assert.deepEqual(buildGroupTotalsPayload(suggestion), {
    total_fare: 15,
    worst_individual_score: 3,
    total_route_distance_km: 20,
    total_route_duration_minutes: 30,
  });
});

test('groupRejection names the rule that failed, with its numbers', () => {
  const remaining = [
    { id: 'a', bagsCount: 2, maxWaitMinutes: 15 },
    { id: 'b', bagsCount: 2, maxWaitMinutes: 15 },
  ];
  const fits: SuggestionLike = {
    members: [member({ id: 'a', waitingMinutes: 10 }), member({ id: 'b', waitingMinutes: 10, extraDetourMinutes: 4, directMinutes: 20 })],
    worstIndividualScore: 9,
    totalRouteDistanceKm: 12,
    totalRouteDurationMinutes: 20,
  };

  assert.equal(groupRejection(fits, remaining, MAX_BAGS, DETOUR_LIMITS), null);
  assert.deepEqual(groupRejection(null, remaining, MAX_BAGS, DETOUR_LIMITS), { reason: 'route_lookup_failed' });
  assert.deepEqual(groupRejection(fits, [...remaining, { id: 'c', bagsCount: 2, maxWaitMinutes: 15 }], MAX_BAGS, DETOUR_LIMITS), {
    reason: 'too_many_bags',
    total_bags: 6,
    max_bags: 4,
  });
  assert.deepEqual(
    groupRejection(
      { ...fits, members: [fits.members[0], member({ id: 'b', extraDetourMinutes: 11, directMinutes: 20 })] },
      remaining,
      MAX_BAGS,
      DETOUR_LIMITS
    ),
    { reason: 'detour_over_limit', request_id: 'b', detour_minutes: 11, allowed_minutes: 10 }
  );
  assert.deepEqual(
    groupRejection({ ...fits, members: [member({ id: 'a', waitingMinutes: 20 }), fits.members[1]] }, remaining, MAX_BAGS, DETOUR_LIMITS),
    { reason: 'wait_over_limit', request_id: 'a', waiting_minutes: 20, max_wait_minutes: 15 }
  );
});
