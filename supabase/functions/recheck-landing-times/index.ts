// Follows the flights of active rides after the passenger entered them - the automatic follow-up
// to the lookup done in the request form (src/services/flightStatus.ts). Runs every 5 minutes, but
// only looks a flight up when it is due (_shared/flightRefresh.ts): nothing earlier than 48 hours
// before landing, a few checkpoints after that, then about every 10 minutes from the scheduled
// departure until the flight has landed. Each lookup is a paid FlightAware call, so rides on the
// same flight share one.
//
// What a lookup changes depends on where the ride is:
//   - Still waiting (no group): its landing time and its terminal follow the flight data.
//   - In an offer (unconfirmed group): the landing time follows the flight and the group is
//     rescored. If the flight now lands at another terminal than the group's, the passenger is
//     taken out of the group and goes back to searching at the new terminal ('terminal_changed').
//   - In a confirmed group: nothing is changed automatically. A different terminal is recorded on
//     the ride (terminal_conflict) and in the audit trail for the admin to act on.
//
// Invoked the same two ways as match-and-group (cron secret or admin JWT); deployed with
// --no-verify-jwt since this file does its own auth check via the shared helper.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { isAuthorized } from '../_shared/auth.ts';
import { ADMIN_EMAIL, FLIGHT_REFRESH_SCHEDULE } from '../_shared/constants.ts';
import { FlightSnapshot, lookupFlight } from '../_shared/flightLookup.ts';
import { isFlightCheckDue } from '../_shared/flightRefresh.ts';
import { acquireLock, releaseLock } from '../_shared/matchLock.ts';
import { computeGroupScore, PendingPassengerRequest } from '../_shared/matchingEngine.ts';
import { removeFromOffer, stripeForOffers } from '../_shared/offers.ts';
import { sendPush } from '../_shared/push.ts';

const LOCK_ID = 2;

const HOUR_MS = 3_600_000;

// Ignores sub-minute differences (formatting noise between polls) so a real schedule change
// is what actually triggers a rescore.
const LANDING_TIME_CHANGE_THRESHOLD_SECONDS = 60;

type RideRow = PendingPassengerRequest & {
  user_id: string | null;
  group_id: string | null;
  scheduled_arrival_at: string | null;
  arrival_terminal: string | null;
  arrival_terminal_source: string | null;
  flight_checked_at: string | null;
  flight_scheduled_departure_at: string | null;
  terminal_conflict: string | null;
};

const RIDE_COLUMNS =
  'id, user_id, group_id, flight_number, arrival_at, destination_address, bags_count, large_luggage_count, max_wait_minutes, destination_lat, destination_lng, scheduled_arrival_at, arrival_terminal, arrival_terminal_source, flight_checked_at, flight_scheduled_departure_at, terminal_conflict';

const MEMBER_COLUMNS =
  'id, flight_number, arrival_at, destination_address, bags_count, large_luggage_count, max_wait_minutes, destination_lat, destination_lng';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  if (!(await isAuthorized(req, adminClient, ADMIN_EMAIL))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  if (!(await acquireLock(adminClient, LOCK_ID))) {
    return jsonResponse({ skipped: true, reason: 'a run is already in progress' });
  }

  try {
    const apiKey = Deno.env.get('FLIGHTAWARE_API_KEY');
    if (!apiKey) {
      return jsonResponse({ error: 'Flight lookup is not configured.' }, 500);
    }

    const now = new Date();
    const nowMs = now.getTime();
    const firstCheckpointHours = Math.max(...FLIGHT_REFRESH_SCHEDULE.checkpointHours);

    // Active rides with a flight that hasn't landed, inside the window in which flights are followed.
    const { data: rows, error: rowsError } = await adminClient
      .from('passenger_requests')
      .select(RIDE_COLUMNS)
      .in('status', ['pending', 'matched'])
      .neq('flight_number', '')
      .is('flight_landed_at', null)
      .gte('arrival_at', new Date(nowMs - FLIGHT_REFRESH_SCHEDULE.giveUpHours * HOUR_MS).toISOString())
      .lte('arrival_at', new Date(nowMs + firstCheckpointHours * HOUR_MS).toISOString());
    if (rowsError) {
      return jsonResponse({ error: rowsError.message }, 500);
    }

    const due = ((rows ?? []) as RideRow[]).filter(
      (ride) =>
        ride.flight_number.trim() !== '' &&
        isFlightCheckDue(
          {
            arrivalAtMs: new Date(ride.arrival_at).getTime(),
            lastCheckedAtMs: ms(ride.flight_checked_at),
            scheduledDepartureMs: ms(ride.flight_scheduled_departure_at),
            landed: false,
          },
          nowMs,
          FLIGHT_REFRESH_SCHEDULE
        )
    );
    if (due.length === 0) {
      return jsonResponse({ ridesChecked: 0, flightsLookedUp: 0 });
    }

    const groupIds = [...new Set(due.map((ride) => ride.group_id).filter((id): id is string => id != null))];
    const { data: groupRows } = groupIds.length
      ? await adminClient.from('taxi_groups').select('id, status').in('id', groupIds)
      : { data: [] };
    const groupStatus = new Map((groupRows ?? []).map((g) => [g.id as string, g.status as string]));

    // One lookup per flight and day, shared by every ride on it.
    const lookups = new Map<string, Promise<FlightSnapshot | null>>();
    const lookupFor = (ride: RideRow) => {
      const flight = ride.flight_number.trim().toUpperCase();
      const key = `${flight}|${ride.arrival_at.slice(0, 10)}`;
      let pending = lookups.get(key);
      if (!pending) {
        pending = lookupFlight(flight, new Date(ride.arrival_at).getTime(), apiKey).catch((err) => {
          console.error('flight lookup failed', err);
          return null;
        });
        lookups.set(key, pending);
      }
      return pending;
    };

    const stripe = stripeForOffers();
    const groupsToRescore = new Set<string>();
    let terminalsUpdated = 0;
    let removedForTerminal = 0;
    let conflictsFlagged = 0;

    for (const ride of due) {
      const snapshot = await lookupFor(ride);
      const status = ride.group_id ? (groupStatus.get(ride.group_id) ?? null) : null;

      // Remember that this flight was looked up now, whatever it said - also when it said nothing,
      // so an unknown flight number isn't asked about again on every run.
      const update: Record<string, unknown> = { flight_checked_at: now.toISOString() };

      if (snapshot) {
        if (snapshot.scheduledDeparture) update.flight_scheduled_departure_at = snapshot.scheduledDeparture;
        if (snapshot.scheduledLanding && ms(snapshot.scheduledLanding) !== ms(ride.scheduled_arrival_at)) {
          update.scheduled_arrival_at = snapshot.scheduledLanding;
        }
        // Landed - or cancelled, which ends the following of this flight just the same.
        if (snapshot.landed || snapshot.cancelled) update.flight_landed_at = now.toISOString();

        // The landing time: a waiting ride and a ride in an offer follow the flight; a confirmed
        // group's times are left alone.
        if (snapshot.estimatedLanding && status !== 'confirmed') {
          const diffSeconds = Math.abs(ms(snapshot.estimatedLanding)! - new Date(ride.arrival_at).getTime()) / 1000;
          if (diffSeconds > LANDING_TIME_CHANGE_THRESHOLD_SECONDS) {
            update.arrival_at = snapshot.estimatedLanding;
            update.arrival_time_source = 'flight';
            if (status === 'unconfirmed' && ride.group_id) groupsToRescore.add(ride.group_id);
          }
        }
      }

      const terminal = snapshot?.terminal ?? null;
      let removed = false;
      if (terminal) {
        if (terminal === ride.arrival_terminal || ride.arrival_terminal == null || !ride.group_id) {
          // Flight data confirms the terminal, or replaces the passenger's own choice while the
          // ride is still waiting.
          if (terminal !== ride.arrival_terminal) terminalsUpdated += 1;
          update.arrival_terminal = terminal;
          update.arrival_terminal_source = 'flight';
          if (ride.terminal_conflict) update.terminal_conflict = null;
        } else if (status === 'unconfirmed') {
          // Another terminal than the offer's: out of the group, back to searching at the new one.
          const result = await removeFromOffer(adminClient, stripe, ride.group_id, ride.id, 'terminal_changed');
          if (result.removed) {
            removed = true;
            removedForTerminal += 1;
            update.arrival_terminal = terminal;
            update.arrival_terminal_source = 'flight';
            groupsToRescore.delete(ride.group_id);
            if (ride.user_id) await sendPush(adminClient, { userId: ride.user_id, key: 'terminalChanged' });
          }
        }
        if (!removed && ride.group_id && ride.arrival_terminal != null && terminal !== ride.arrival_terminal) {
          // A confirmed group (or an offer the passenger couldn't be taken out of): flag it for
          // the admin, once per reported terminal.
          if (ride.terminal_conflict !== terminal) {
            update.terminal_conflict = terminal;
            conflictsFlagged += 1;
            await adminClient.from('group_events').insert({
              group_id: ride.group_id,
              request_id: ride.id,
              event_type: 'terminal_conflict',
              details: { group_terminal: ride.arrival_terminal, flight_terminal: terminal },
              actor_type: 'system',
            });
          }
        }
      }

      const { error: updateError } = await adminClient.from('passenger_requests').update(update).eq('id', ride.id);
      if (updateError) console.error('updating a ride after its flight lookup failed', updateError.message);
    }

    // Offers whose landing times moved: same rescore as before, on the group as it is now.
    let groupsRescored = 0;
    for (const groupId of groupsToRescore) {
      const { data: group } = await adminClient.from('taxi_groups').select('status').eq('id', groupId).maybeSingle();
      if (group?.status !== 'unconfirmed') continue;

      const { data: memberRows } = await adminClient.from('passenger_requests').select(MEMBER_COLUMNS).eq('group_id', groupId);
      const members = ((memberRows ?? []) as PendingPassengerRequest[]).filter(
        (r): r is PendingPassengerRequest & { destination_lat: number; destination_lng: number } =>
          r.destination_lat != null && r.destination_lng != null
      );
      if (members.length < 2 || members.length !== (memberRows ?? []).length) continue;

      const suggestion = await computeGroupScore(members);
      if (!suggestion) continue;

      await Promise.all(
        suggestion.members.map((m) =>
          adminClient
            .from('passenger_requests')
            .update({
              distance_km: m.distanceKm,
              extra_detour_minutes: m.extraDetourMinutes,
              waiting_minutes: m.waitingMinutes,
              individual_score: m.individualScore,
            })
            .eq('id', m.id)
        )
      );

      const totalFare = suggestion.members.reduce((sum, m) => sum + m.fareAmount, 0);
      await adminClient
        .from('taxi_groups')
        .update({
          total_fare: totalFare,
          worst_individual_score: suggestion.worstIndividualScore,
          total_route_distance_km: suggestion.totalRouteDistanceKm,
          total_route_duration_minutes: suggestion.totalRouteDurationMinutes,
        })
        .eq('id', groupId);

      groupsRescored++;
    }

    return jsonResponse({
      ridesChecked: due.length,
      flightsLookedUp: lookups.size,
      groupsRescored,
      terminalsUpdated,
      removedForTerminal,
      conflictsFlagged,
    });
  } finally {
    await releaseLock(adminClient, LOCK_ID);
  }
});
