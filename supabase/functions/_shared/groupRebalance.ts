// Pure decision logic for rescoring a group after a member leaves via an edit (see
// edit-passenger-request/index.ts, which glues this to computeGroupScore + the
// begin_passenger_request_edit / apply_group_rescore SQL functions).
//
// Deliberately has zero imports from matchingEngine.ts/googleRoutes.ts: those pull in a
// Deno.env.get(...) call at module scope, which would throw the moment this file is imported
// under Node - and this file is exercised by a plain Node unit test (see
// groupRebalance.test.ts), not just the Deno Edge Function runtime. The types below are
// structurally compatible with matchingEngine.ts's MatchSuggestion/MatchMember, so a real
// MatchSuggestion can be passed in as-is.

export type SuggestionMemberLike = {
  id: string;
  extraDetourMinutes: number;
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
  bagsCount: number;
  maxWaitMinutes: number;
};

// Re-checks each surviving member's own constraints (detour, their own wait tolerance, and the
// taxi's total luggage capacity) now that the group is smaller. A null suggestion means the
// route recomputation itself failed (e.g. Google Routes returned nothing usable) - treated as
// "no longer valid" rather than silently keeping stale numbers.
export function isGroupStillValid(
  suggestion: SuggestionLike | null,
  members: RemainingMember[],
  maxBagsPerTaxi: number,
  maxDetourMinutes: number
): boolean {
  if (!suggestion) return false;

  const totalBags = members.reduce((sum, m) => sum + m.bagsCount, 0);
  if (totalBags > maxBagsPerTaxi) return false;

  const maxWaitById = new Map(members.map((m) => [m.id, m.maxWaitMinutes]));

  return suggestion.members.every((m) => {
    if (m.extraDetourMinutes > maxDetourMinutes) return false;
    const ownMaxWait = maxWaitById.get(m.id);
    return ownMaxWait == null || m.waitingMinutes <= ownMaxWait;
  });
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
