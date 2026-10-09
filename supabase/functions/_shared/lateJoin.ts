// Late join: before the matching job forms new groups, it tries to place each waiting passenger
// into a group that is still an offer ("Match found", unconfirmed) and has a free seat. A group
// confirms itself as soon as everyone in it has secured their spot, so this only ever reaches
// groups in which someone hasn't answered yet.
//
// A passenger joins only if the enlarged group passes every rule (lateJoinRule.ts): arrivals
// within each other's maximum wait, each passenger's own detour and wait, large luggage, and
// nobody already in the group paying more than they would now. Passengers who declined each
// other, and a passenger who left this same group before, are never put together again. The
// response window then restarts so the newcomer gets a full one; passengers who already secured
// their spot stay secured (their reservation covers the lower share).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  AIRPORT,
  CORRIDOR_METERS,
  DETOUR_LIMITS,
  LATE_JOIN_MIN_MINUTES_BEFORE_RIDE,
  MAX_LARGE_LUGGAGE_PER_TAXI,
  MAX_PASSENGERS_PER_TAXI,
} from './constants.ts';
import { buildGroupTotalsPayload, buildMemberScoresPayload } from './groupRebalance.ts';
import { estimatedSharesCents, rideDepartureMs } from './holdMath.ts';
import { syncGroupHolds } from './holds.ts';
import { arrivalsCompatible, joinRejection } from './lateJoinRule.ts';
import type { JoinMember } from './lateJoinRule.ts';
import { computeGroupScore, MatchSuggestion, PendingPassengerRequest } from './matchingEngine.ts';
import { offerExpiresAt, stripeForOffers } from './offers.ts';
import { sendPush } from './push.ts';
import { sameTerminal } from './terminalRule.ts';

type Geocoded = PendingPassengerRequest & { destination_lat: number; destination_lng: number };

type OfferMember = Geocoded & { user_id: string | null; group_id: string; distance_km: number | null };

type OpenOffer = { id: string; version: number; total_fare: number; members: OfferMember[] };

const MEMBER_COLUMNS =
  'id, user_id, group_id, flight_number, arrival_at, destination_address, bags_count, large_luggage_count, max_wait_minutes, destination_lat, destination_lng, distance_km, arrival_terminal';

const MINUTE_MS = 60_000;

const toJoinMember = (r: PendingPassengerRequest): JoinMember => ({
  id: r.id,
  arrivalAt: r.arrival_at,
  largeLuggageCount: r.large_luggage_count,
  maxWaitMinutes: r.max_wait_minutes,
});

// Offers a waiting passenger could still join: announced (their response window is running), not
// full, fully scored, and not about to leave.
async function loadOpenOffers(adminClient: SupabaseClient, now: Date): Promise<OpenOffer[]> {
  const { data: groups } = await adminClient
    .from('taxi_groups')
    .select('id, version, total_fare')
    .eq('status', 'unconfirmed')
    .not('offer_expires_at', 'is', null)
    .not('total_fare', 'is', null);
  if (!groups?.length) return [];

  const { data: memberRows } = await adminClient
    .from('passenger_requests')
    .select(MEMBER_COLUMNS)
    .in(
      'group_id',
      groups.map((g) => g.id)
    );

  const membersByGroup = new Map<string, OfferMember[]>();
  for (const row of (memberRows ?? []) as OfferMember[]) {
    membersByGroup.set(row.group_id, [...(membersByGroup.get(row.group_id) ?? []), row]);
  }

  const latestStartMs = now.getTime() + LATE_JOIN_MIN_MINUTES_BEFORE_RIDE * MINUTE_MS;
  return groups
    .map((g) => ({ id: g.id, version: g.version, total_fare: Number(g.total_fare), members: membersByGroup.get(g.id) ?? [] }))
    .filter(
      (offer) =>
        offer.members.length >= 2 &&
        offer.members.length < MAX_PASSENGERS_PER_TAXI &&
        offer.members.every((m) => m.destination_lat != null && m.destination_lng != null && m.distance_km != null) &&
        rideDepartureMs(offer.members.map((m) => m.arrival_at)) > latestStartMs
    );
}

// Same corridor layer as the matching job: the waiting passengers whose destination lies along
// the route to this group member's destination.
async function pendingInCorridor(adminClient: SupabaseClient, memberId: string): Promise<Set<string>> {
  const { data } = await adminClient.rpc('match_corridor_candidates', {
    p_request_id: memberId,
    p_airport_lat: AIRPORT.lat,
    p_airport_lng: AIRPORT.lng,
    p_corridor_meters: CORRIDOR_METERS,
  });
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}

// Places waiting passengers into open offers where they fit. Returns the ids of the passengers
// that were placed, so the caller leaves them out when forming new groups.
export async function joinOpenOffers(
  adminClient: SupabaseClient,
  pending: PendingPassengerRequest[],
  now = new Date()
): Promise<Set<string>> {
  const joined = new Set<string>();
  const waiting = pending.filter((r): r is Geocoded => r.destination_lat != null && r.destination_lng != null);
  if (waiting.length === 0) return joined;

  const offers = await loadOpenOffers(adminClient, now);
  if (offers.length === 0) return joined;

  const waitingIds = waiting.map((r) => r.id);
  const offerIds = offers.map((o) => o.id);

  const [{ data: declines }, { data: departures }] = await Promise.all([
    adminClient.from('match_declines').select('request_id, declined_request_id').in('request_id', waitingIds),
    adminClient
      .from('group_events')
      .select('group_id, request_id')
      .in('group_id', offerIds)
      .in('request_id', waitingIds)
      .in('event_type', ['match_declined', 'offer_expired', 'member_removed']),
  ]);
  const declined = new Set((declines ?? []).map((d) => `${d.request_id}:${d.declined_request_id}`));
  const leftBefore = new Set((departures ?? []).map((e) => `${e.group_id}:${e.request_id}`));

  // Which waiting passengers are along the way of each offer (any of its members' routes).
  const alongTheWay = new Map<string, Set<string>>();
  for (const offer of offers) {
    const ids = new Set<string>();
    for (const member of offer.members) {
      (await pendingInCorridor(adminClient, member.id)).forEach((id) => ids.add(id));
    }
    alongTheWay.set(offer.id, ids);
  }

  const stripe = stripeForOffers();
  // An offer takes at most one newcomer per run: after that its members and numbers have changed.
  const changedOffers = new Set<string>();

  for (const newcomer of waiting) {
    let best: { offer: OpenOffer; suggestion: MatchSuggestion } | null = null;

    for (const offer of offers) {
      if (changedOffers.has(offer.id)) continue;
      // Hard rule: only an offer at the newcomer's own terminal.
      if (offer.members.some((m) => !sameTerminal(m.arrival_terminal, newcomer.arrival_terminal))) continue;
      if (!alongTheWay.get(offer.id)?.has(newcomer.id)) continue;
      if (leftBefore.has(`${offer.id}:${newcomer.id}`)) continue;
      if (offer.members.some((m) => declined.has(`${newcomer.id}:${m.id}`))) continue;
      // The rules that need no route lookup first, so Google is only asked about real candidates.
      if (offer.members.some((m) => !arrivalsCompatible(toJoinMember(m), toJoinMember(newcomer)))) continue;
      const largeLuggage = offer.members.reduce((sum, m) => sum + m.large_luggage_count, newcomer.large_luggage_count);
      if (largeLuggage > MAX_LARGE_LUGGAGE_PER_TAXI) continue;

      const suggestion = await computeGroupScore([...offer.members, newcomer]);
      const currentShares = estimatedSharesCents(
        offer.members.map((m) => ({ id: m.id, distanceKm: Number(m.distance_km) })),
        offer.total_fare
      );
      const rejection = joinRejection(
        suggestion,
        offer.members.map(toJoinMember),
        toJoinMember(newcomer),
        currentShares,
        MAX_LARGE_LUGGAGE_PER_TAXI,
        DETOUR_LIMITS
      );
      if (rejection || !suggestion) continue;

      if (!best || suggestion.worstIndividualScore < best.suggestion.worstIndividualScore) {
        best = { offer, suggestion };
      }
    }

    if (!best) continue;
    const { offer, suggestion } = best;

    const expiresAt = offerExpiresAt(now);
    const { data: commit, error } = await adminClient.rpc('system_commit_join_offer', {
      p_group_id: offer.id,
      p_request_id: newcomer.id,
      p_expected_version: offer.version,
      p_member_scores: buildMemberScoresPayload(suggestion),
      p_group_totals: buildGroupTotalsPayload(suggestion),
      p_offer_expires_at: expiresAt,
    });
    // Whatever happened, this offer is no longer what was read at the start of the run.
    changedOffers.add(offer.id);
    if (error) {
      console.error('system_commit_join_offer failed', error);
      continue;
    }
    if (!(commit as { applied: boolean }).applied) continue;

    joined.add(newcomer.id);

    // Existing reservations stay (they cover the lower share); their amounts are brought in line.
    if (stripe) {
      try {
        await syncGroupHolds(adminClient, stripe, offer.id, now);
      } catch (err) {
        // The 5-minute payments-sync-holds job retries this.
        console.error('syncGroupHolds after a late join failed', err);
      }
    }

    for (const member of offer.members) {
      const fare = suggestion.members.find((m) => m.id === member.id)?.fareAmount;
      if (member.user_id && fare != null) {
        await sendPush(adminClient, { userId: member.user_id, key: 'memberJoined', amountCents: Math.round(fare * 100) });
      }
    }
    const { data: newcomerRow } = await adminClient.from('passenger_requests').select('user_id').eq('id', newcomer.id).single();
    if (newcomerRow?.user_id) {
      await sendPush(adminClient, { userId: newcomerRow.user_id, key: 'matchFound', timeIso: expiresAt });
    }
  }

  return joined;
}
