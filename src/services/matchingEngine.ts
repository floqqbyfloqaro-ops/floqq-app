import {
  AIRPORT,
  CORRIDOR_METERS,
  GROUP_DEPARTURE_BUFFER_MINUTES,
  MAX_BAGS_PER_TAXI,
  DETOUR_LIMITS,
  MAX_PASSENGERS_PER_TAXI,
  SCORE_WEIGHTS,
} from '../constants';
import { PendingPassengerRequest } from './adminGrouping';
import { exceedsDetourLimit } from './detourLimit';
import { calculateBarcelonaTaxiFare, calculateFareSplit } from './fareSplit';
import { computeRouteMatrix, LatLng, RouteMatrixCell } from './googleRoutes';
import { supabase } from './supabase';

type GeoRequest = PendingPassengerRequest & { destination_lat: number; destination_lng: number };

export type MatchMember = {
  id: string;
  passengerName: string | null;
  flightNumber: string;
  extraDetourMinutes: number;
  // This passenger's solo airport -> destination time, the base for the percentage detour cap.
  directMinutes: number | null;
  waitingMinutes: number;
  distanceKm: number;
  fareAmount: number;
  individualScore: number;
};

export type MatchSuggestion = {
  requestIds: string[];
  members: MatchMember[];
  totalRouteDistanceKm: number;
  totalRouteDurationMinutes: number;
  worstIndividualScore: number;
};

function hasCoordinates(request: PendingPassengerRequest): request is GeoRequest {
  return request.destination_lat != null && request.destination_lng != null;
}

function isArrivalWindowCompatible(a: PendingPassengerRequest, b: PendingPassengerRequest): boolean {
  const diffMinutes = Math.abs(new Date(a.arrival_at).getTime() - new Date(b.arrival_at).getTime()) / 60000;
  return diffMinutes <= Math.min(a.max_wait_minutes, b.max_wait_minutes);
}

// Layer 1 (per-candidate part): same airport (single-airport MVP, always true today) and a
// compatible arrival window. The remaining hard constraints (group size cap, luggage cap) are
// checked once actual candidate groups are assembled below.
function filterHardConstraints(anchor: PendingPassengerRequest, pool: GeoRequest[]): GeoRequest[] {
  return pool.filter((candidate) => candidate.id !== anchor.id && isArrivalWindowCompatible(anchor, candidate));
}

// Layer 2: PostGIS corridor filter - keeps only destinations near the straight line from the
// airport to the anchor passenger's destination.
async function filterByCorridor(anchor: GeoRequest, eligibleIds: Set<string>): Promise<GeoRequest[]> {
  const { data, error } = await supabase.rpc('match_corridor_candidates', {
    p_request_id: anchor.id,
    p_airport_lat: AIRPORT.lat,
    p_airport_lng: AIRPORT.lng,
    p_corridor_meters: CORRIDOR_METERS,
  });

  if (error || !data) {
    return [];
  }

  return (data as PendingPassengerRequest[]).filter(
    (row): row is GeoRequest => eligibleIds.has(row.id) && hasCoordinates(row)
  );
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  const withFirst = combinations(rest, size - 1).map((combo) => [first, ...combo]);
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const result: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const perm of permutations(rest)) {
      result.push([item, ...perm]);
    }
  });
  return result;
}

function cellLookup(cells: RouteMatrixCell[]): Map<string, RouteMatrixCell> {
  const map = new Map<string, RouteMatrixCell>();
  cells.forEach((cell) => map.set(`${cell.originIndex}:${cell.destinationIndex}`, cell));
  return map;
}

// Layers 3 (real travel time) + 4 (per-passenger score) for one candidate group, with no
// threshold applied - used both by scoreGroup below (which gates new candidate groups) and
// directly by callers rescoring an *existing* group, where there's nothing to "reject" since
// the group already exists.
export async function computeGroupScore(group: GeoRequest[]): Promise<MatchSuggestion | null> {
  const points: LatLng[] = [
    { lat: AIRPORT.lat, lng: AIRPORT.lng },
    ...group.map((r) => ({ lat: r.destination_lat, lng: r.destination_lng })),
  ];

  const cells = await computeRouteMatrix(points);
  if (cells.length === 0) return null;
  const lookup = cellLookup(cells);

  // Point index 0 is the airport; passenger i sits at matrix index i + 1.
  const soloDurationSec = (passengerIndex: number) => lookup.get(`0:${passengerIndex + 1}`)?.durationSec ?? null;

  const passengerIndices = group.map((_, i) => i);
  let bestOrder: number[] | null = null;
  let bestTotalDurationSec = Infinity;

  for (const order of permutations(passengerIndices)) {
    let totalSec = 0;
    let fromIndex = 0;
    let valid = true;
    for (const passengerIndex of order) {
      const cell = lookup.get(`${fromIndex}:${passengerIndex + 1}`);
      if (!cell) {
        valid = false;
        break;
      }
      totalSec += cell.durationSec;
      fromIndex = passengerIndex + 1;
    }
    if (valid && totalSec < bestTotalDurationSec) {
      bestTotalDurationSec = totalSec;
      bestOrder = order;
    }
  }

  if (!bestOrder) return null;

  let cumulativeSec = 0;
  let cumulativeMeters = 0;
  let fromIndex = 0;
  const cumulativeByPassengerIndex = new Map<number, { sec: number; meters: number }>();

  for (const passengerIndex of bestOrder) {
    const cell = lookup.get(`${fromIndex}:${passengerIndex + 1}`);
    if (!cell) return null;
    cumulativeSec += cell.durationSec;
    cumulativeMeters += cell.distanceMeters;
    cumulativeByPassengerIndex.set(passengerIndex, { sec: cumulativeSec, meters: cumulativeMeters });
    fromIndex = passengerIndex + 1;
  }

  const totalRouteDistanceKm = cumulativeMeters / 1000;

  const latestArrivalMs = Math.max(...group.map((r) => new Date(r.arrival_at).getTime()));
  const groupDepartureMs = latestArrivalMs + GROUP_DEPARTURE_BUFFER_MINUTES * 60000;

  // Real regulated Barcelona tariff (day/night/weekend rate + airport supplement) for the actual
  // km driven, priced at the taxi's real departure time - not a flat per-km estimate.
  const estimatedTotalFare = calculateBarcelonaTaxiFare(totalRouteDistanceKm, new Date(groupDepartureMs));

  // Reuses the Phase 1 fare-split module - each passenger's share of the estimated total fare,
  // weighted by how far along the shared route their stop is.
  const fareInputs = group.map((request, index) => ({
    id: request.id,
    distanceKm: (cumulativeByPassengerIndex.get(index)?.meters ?? 0) / 1000,
  }));
  const fareById = new Map(calculateFareSplit(fareInputs, estimatedTotalFare).map((f) => [f.id, f.amount]));

  const members: MatchMember[] = group.map((request, index) => {
    const cumulative = cumulativeByPassengerIndex.get(index);
    const solo = soloDurationSec(index);
    const extraDetourMinutes = cumulative && solo != null ? (cumulative.sec - solo) / 60 : 0;
    const waitingMinutes = Math.max(0, (groupDepartureMs - new Date(request.arrival_at).getTime()) / 60000);
    const distanceKm = (cumulative?.meters ?? 0) / 1000;
    const fareAmount = fareById.get(request.id) ?? 0;
    const individualScore =
      SCORE_WEIGHTS.detourMinute * extraDetourMinutes +
      SCORE_WEIGHTS.waitMinute * waitingMinutes +
      SCORE_WEIGHTS.fareEuro * fareAmount;

    return {
      id: request.id,
      passengerName: request.passenger_name,
      flightNumber: request.flight_number,
      extraDetourMinutes,
      directMinutes: solo != null ? solo / 60 : null,
      waitingMinutes,
      distanceKm,
      fareAmount,
      individualScore,
    };
  });

  return {
    requestIds: group.map((r) => r.id),
    members,
    totalRouteDistanceKm,
    totalRouteDurationMinutes: cumulativeSec / 60,
    worstIndividualScore: Math.max(...members.map((m) => m.individualScore)),
  };
}

// Used when forming brand-new candidate groups: computes the score, then rejects the group
// outright if any single passenger's detour is over their own limit (detourLimit.ts) - never
// just averaged away by the rest of the group looking good.
async function scoreGroup(group: GeoRequest[]): Promise<MatchSuggestion | null> {
  const suggestion = await computeGroupScore(group);
  if (!suggestion) return null;
  if (suggestion.members.some((m) => exceedsDetourLimit(m, DETOUR_LIMITS))) return null;
  return suggestion;
}

// Runs all 4 layers over the current pending pool and returns ranked group suggestions
// (best worst-case individual score first).
export async function suggestTaxiGroups(pending: PendingPassengerRequest[]): Promise<MatchSuggestion[]> {
  const geocoded = pending.filter(hasCoordinates);
  const suggestions: MatchSuggestion[] = [];
  const seenGroupKeys = new Set<string>();

  for (const anchor of geocoded) {
    const layer1Pool = filterHardConstraints(anchor, geocoded);
    const layer1Ids = new Set(layer1Pool.map((r) => r.id));
    const corridorPool = await filterByCorridor(anchor, layer1Ids);

    for (let companionCount = 1; companionCount <= MAX_PASSENGERS_PER_TAXI - 1; companionCount++) {
      for (const companions of combinations(corridorPool, companionCount)) {
        const group = [anchor, ...companions];

        const totalBags = group.reduce((sum, r) => sum + r.bags_count, 0);
        if (totalBags > MAX_BAGS_PER_TAXI) continue;

        const groupKey = group
          .map((r) => r.id)
          .sort()
          .join(',');
        if (seenGroupKeys.has(groupKey)) continue;
        seenGroupKeys.add(groupKey);

        const suggestion = await scoreGroup(group);
        if (suggestion) {
          suggestions.push(suggestion);
        }
      }
    }
  }

  return suggestions.sort((a, b) => a.worstIndividualScore - b.worstIndividualScore);
}
