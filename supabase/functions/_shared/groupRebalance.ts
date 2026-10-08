// Pure decision logic for rescoring a group after a member leaves via an edit (see
// edit-passenger-request/index.ts, which glues this to computeGroupScore + the
// begin_passenger_request_edit / apply_group_rescore SQL functions).
//
// Deliberately has zero imports from matchingEngine.ts/googleRoutes.ts: those pull in a
// Deno.env.get(...) call at module scope, which would throw the moment this file is imported
// under Node - and this file is exercised by a plain Node unit test (see
// groupRebalance.test.ts), not just the Deno Edge Function runtime. The types below are
// structurally compatible with matchingEngine.ts's MatchSuggestion/MatchMember, so a real
// MatchSuggestion can be passed in as-is. (detourLimit.ts is import-free too, so it's safe here.)

import { allowedDetourMinutes, exceedsDetourLimit } from './detourLimit.ts';
import type { DetourLimits } from './detourLimit.ts';

export type SuggestionMemberLike = {
  id: string;
  extraDetourMinutes: number;
  directMinutes?: number | null;
  waitingMinutes: number;
  distanceKm: number;
  fareAmount: number;
  individualScore: number;
};

export type SuggestionLike = {
  members: SuggestionMemberLike[];
  worstIndividualScore: number;
  totalRouteDistanceKm: number;
  totalRouteDurationMinutes: number;
};

export type RemainingMember = {
  id: string;
  largeLuggageCount: number;
  maxWaitMinutes: number;
};

// Why a group no longer fits, with the numbers behind it - recorded in the audit trail when a
// rescore dissolves a group, so "no longer compatible" can be explained afterwards.
export type GroupRejection =
  | { reason: 'route_lookup_failed' }
  | { reason: 'too_much_large_luggage'; total_large_luggage: number; max_large_luggage: number }
  | { reason: 'detour_over_limit'; request_id: string; detour_minutes: number; allowed_minutes: number }
  | { reason: 'wait_over_limit'; request_id: string; waiting_minutes: number; max_wait_minutes: number };

// Re-checks each surviving member's own constraints (detour, their own wait tolerance, and the
// taxi's large-luggage capacity - hand luggage doesn't count) now that the group is smaller, and returns the first one that
// fails - null when the group still fits. A null suggestion means the route recomputation itself
// failed (e.g. Google Routes returned nothing usable) - treated as "no longer valid" rather than
// silently keeping stale numbers.
export function groupRejection(
  suggestion: SuggestionLike | null,
  members: RemainingMember[],
  maxLargeLuggagePerTaxi: number,
  detourLimits: DetourLimits
): GroupRejection | null {
  if (!suggestion) return { reason: 'route_lookup_failed' };

  const totalLargeLuggage = members.reduce((sum, m) => sum + m.largeLuggageCount, 0);
  if (totalLargeLuggage > maxLargeLuggagePerTaxi) return { reason: 'too_much_large_luggage', total_large_luggage: totalLargeLuggage, max_large_luggage: maxLargeLuggagePerTaxi };

  const maxWaitById = new Map(members.map((m) => [m.id, m.maxWaitMinutes]));

  for (const m of suggestion.members) {
    if (exceedsDetourLimit(m, detourLimits)) {
      return {
        reason: 'detour_over_limit',
        request_id: m.id,
        detour_minutes: m.extraDetourMinutes,
        allowed_minutes: allowedDetourMinutes(m.directMinutes, detourLimits),
      };
    }
    const ownMaxWait = maxWaitById.get(m.id);
    if (ownMaxWait != null && m.waitingMinutes > ownMaxWait) {
      return { reason: 'wait_over_limit', request_id: m.id, waiting_minutes: m.waitingMinutes, max_wait_minutes: ownMaxWait };
    }
  }
  return null;
}

export function isGroupStillValid(
  suggestion: SuggestionLike | null,
  members: RemainingMember[],
  maxLargeLuggagePerTaxi: number,
  detourLimits: DetourLimits
): boolean {
  return groupRejection(suggestion, members, maxLargeLuggagePerTaxi, detourLimits) === null;
}

export function buildMemberScoresPayload(suggestion: SuggestionLike) {
  return suggestion.members.map((m) => ({
    id: m.id,
    distance_km: m.distanceKm,
    extra_detour_minutes: m.extraDetourMinutes,
    waiting_minutes: m.waitingMinutes,
    individual_score: m.individualScore,
  }));
}

export function buildGroupTotalsPayload(suggestion: SuggestionLike) {
  return {
    total_fare: suggestion.members.reduce((sum, m) => sum + m.fareAmount, 0),
    worst_individual_score: suggestion.worstIndividualScore,
    total_route_distance_km: suggestion.totalRouteDistanceKm,
    total_route_duration_minutes: suggestion.totalRouteDurationMinutes,
  };
}
