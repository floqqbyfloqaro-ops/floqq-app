// Follows the flights of active rides after the passenger entered them - the automatic follow-up
// to the lookup done in the request form (src/services/flightStatus.ts). Runs every 5 minutes, but
// only looks a flight up when it is due (_shared/flightRefresh.ts): nothing earlier than 48 hours
// before landing, a few checkpoints after that, then about every 30 minutes from the scheduled
// departure until the flight has landed. Each lookup is a paid FlightAware call, so rides on the
// same flight share one.
//
// The terminal a lookup gives is the one the flight data names; while it names none, the one the
// operating airline lands at (airline_terminals) - which only ever replaces a terminal that came
// from that table, never the passenger's own choice.
//
// What a lookup changes depends on where the ride is:
//   - Still waiting (no group): its landing time and its terminal follow the flight data.
//   - In an offer (unconfirmed group): the landing time follows the flight - and with it the
//     passenger's ready time, which the database recalculates - and the group is checked again
//     (rescoreGroup): if every member's wait and detour still fit it is rescored, otherwise it is
//     dissolved and its passengers are matched afresh. If the flight now lands at another terminal
//     than the group's, the passenger is taken out of the group and goes back to searching at the
//     new terminal ('terminal_changed').
//   - In a confirmed group: nothing is changed automatically. A different terminal is recorded on
//     the ride (terminal_conflict), and a flight that now arrives READY_TIME_FLAG_MINUTES or more
//     off the group's time is recorded in the audit trail ('ready_time_conflict'); the admin
//     dashboard shows both.
//
// Invoked the same two ways as match-and-group (cron secret or admin JWT); deployed with
// --no-verify-jwt since this file does its own auth check via the shared helper.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { airlineCodeOf, airlineTerminal } from '../_shared/airlineTerminalRule.ts';
import { loadAirlineTerminals, recordTerminalMismatch } from '../_shared/airlineTerminals.ts';
import { isAuthorized } from '../_shared/auth.ts';
import { FLIGHT_REFRESH_SCHEDULE, READY_TIME_FLAG_MINUTES } from '../_shared/constants.ts';
import { airportDayKey, cachedLookupFlight, JOB_CACHE_MAX_AGE_MS } from '../_shared/flightLookup.ts';
import type { FlightSnapshot } from '../_shared/flightLookup.ts';
import { monitored } from '../_shared/jobRuns.ts';
import { isFlightCheckDue } from '../_shared/flightRefresh.ts';
import { acquireLock, releaseLock } from '../_shared/matchLock.ts';
import type { PendingPassengerRequest } from '../_shared/matchingEngine.ts';
import { removeFromOffer, stripeForOffers } from '../_shared/offers.ts';
import { sendPush } from '../_shared/push.ts';
import { rescoreGroup } from '../_shared/rescoreGroup.ts';

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
  flight_estimated_arrival_at: string | null;
  ready_buffer_minutes: number | null;
  flight_operator_iata: string | null;
  flight_origin_icao: string | null;
  terminal_conflict: string | null;
};

const RIDE_COLUMNS =
  'id, user_id, group_id, flight_number, arrival_at, destination_address, bags_count, large_luggage_count, max_wait_minutes, destination_lat, destination_lng, scheduled_arrival_at, arrival_terminal, arrival_terminal_source, flight_checked_at, flight_scheduled_departure_at, flight_estimated_arrival_at, ready_buffer_minutes, flight_operator_iata, flight_origin_icao, terminal_conflict';


function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

// Every run leaves a trace for the admin dashboard (_shared/jobRuns.ts).
Deno.serve(monitored('recheck-landing-times', async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  if (!(await isAuthorized(req, adminClient))) {
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

    // One lookup per flight and day, shared by every ride on it - and with the request form, when
    // it looked the same flight up moments ago.
    const lookups = new Map<string, Promise<FlightSnapshot | null>>();
    const lookupFor = (ride: RideRow) => {
      const flight = ride.flight_number.trim().toUpperCase();
      const arrivalMs = new Date(ride.arrival_at).getTime();
      const key = `${flight}|${airportDayKey(arrivalMs)}`;
      let pending = lookups.get(key);
      if (!pending) {
        pending = cachedLookupFlight(adminClient, flight, arrivalMs, apiKey, JOB_CACHE_MAX_AGE_MS).catch((err) => {
          console.error('flight lookup failed', err);
          return null;
        });
        lookups.set(key, pending);
      }
      return pending;
    };

    const airlines = await loadAirlineTerminals(adminClient);

    const stripe = stripeForOffers();
    const groupsToRescore = new Set<string>();
    let readyTimeConflicts = 0;
    let terminalsUpdated = 0;
    let removedForTerminal = 0;
    let conflictsFlagged = 0;

    for (const ride of due) {
      const found = await lookupFor(ride);
      // Another day's flight under the same number says which airline flies it, nothing more.
      const snapshot = found?.onExpectedDay ? found : null;
      const operatorIata = found?.operatorIata ?? ride.flight_operator_iata;
      const status = ride.group_id ? (groupStatus.get(ride.group_id) ?? null) : null;

      // Remember that this flight was looked up now, whatever it said - also when it said nothing,
      // so an unknown flight number isn't asked about again on every run.
      const update: Record<string, unknown> = { flight_checked_at: now.toISOString() };
      if (operatorIata !== ride.flight_operator_iata) update.flight_operator_iata = operatorIata;
      // Where the flight comes from decides the ride's ready time (the database calculates it):
      // passport control or not. Another day's flight under the same number flies the same route.
      if (found?.originIcao && found.originIcao !== ride.flight_origin_icao) {
        update.flight_origin_icao = found.originIcao;
        update.flight_origin_iata = found.originIata;
      }

      if (snapshot) {
        if (snapshot.scheduledDeparture) update.flight_scheduled_departure_at = snapshot.scheduledDeparture;
        // Kept for every ride, also in a confirmed group whose own times are left alone: it is
        // what "You've landed" goes by (_shared/landedRule.ts).
        if (snapshot.estimatedLanding) update.flight_estimated_arrival_at = snapshot.estimatedLanding;
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

        // A confirmed group keeps its times - but the admin is told when a member's flight now
        // arrives well off them: once per new estimate, not on every lookup.
        if (snapshot.estimatedLanding && status === 'confirmed' && ride.group_id) {
          const offMinutes = Math.abs(ms(snapshot.estimatedLanding)! - new Date(ride.arrival_at).getTime()) / 60_000;
          const isNewEstimate = ms(snapshot.estimatedLanding) !== ms(ride.flight_estimated_arrival_at);
          if (offMinutes >= READY_TIME_FLAG_MINUTES && isNewEstimate) {
            readyTimeConflicts += 1;
            const bufferMs = (ride.ready_buffer_minutes ?? 0) * 60_000;
            await adminClient.from('group_events').insert({
              group_id: ride.group_id,
              request_id: ride.id,
              event_type: 'ready_time_conflict',
              details: {
                group_arrival_at: ride.arrival_at,
                flight_arrival_at: snapshot.estimatedLanding,
                group_ready_at: new Date(new Date(ride.arrival_at).getTime() + bufferMs).toISOString(),
                flight_ready_at: new Date(ms(snapshot.estimatedLanding)! + bufferMs).toISOString(),
              },
              actor_type: 'system',
            });
          }
        }
      }

      // The operating airline first: on a codeshare it is not the airline in the flight number.
      const airline = airlineTerminal(airlines, [operatorIata, airlineCodeOf(ride.flight_number)]);
      const flightTerminal = snapshot?.terminal ?? null;
      if (flightTerminal && airline && flightTerminal !== airline.terminal) {
        await recordTerminalMismatch(adminClient, {
          airlineIata: airline.airline_iata,
          flightNumber: ride.flight_number,
          flightDate: airportDayKey(new Date(ride.arrival_at).getTime()),
          tableTerminal: airline.terminal,
          reportedTerminal: flightTerminal,
        });
      }

      // Flight data wins over everything. The airline table only stands in while flight data
      // names no terminal, and only for a terminal that came from that table in the first place
      // (or a ride without one) - not over the passenger's own choice or earlier flight data.
      const airlineApplies =
        airline != null && (ride.arrival_terminal == null || ride.arrival_terminal_source === 'airline');
      const terminal = flightTerminal ?? (airlineApplies ? (airline?.terminal ?? null) : null);
      const terminalSource = flightTerminal ? 'flight' : 'airline';

      let removed = false;
      if (terminal) {
        if (terminal === ride.arrival_terminal || ride.arrival_terminal == null || !ride.group_id) {
          // Confirms the terminal, or replaces it while the ride is still waiting.
          if (terminal !== ride.arrival_terminal) {
            terminalsUpdated += 1;
            if (ride.arrival_terminal != null) {
              await adminClient.from('group_events').insert({
                group_id: null,
                request_id: ride.id,
                event_type: 'terminal_changed',
                details: { from: ride.arrival_terminal, to: terminal, source: terminalSource },
                actor_type: 'system',
              });
            }
          }
          update.arrival_terminal = terminal;
          update.arrival_terminal_source = terminalSource;
          if (ride.terminal_conflict) update.terminal_conflict = null;
        } else if (status === 'unconfirmed') {
          // Another terminal than the offer's: out of the group, back to searching at the new one.
          const result = await removeFromOffer(adminClient, stripe, ride.group_id, ride.id, 'terminal_changed');
          if (result.removed) {
            removed = true;
            removedForTerminal += 1;
            update.arrival_terminal = terminal;
            update.arrival_terminal_source = terminalSource;
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
              details: { group_terminal: ride.arrival_terminal, flight_terminal: terminal, source: terminalSource },
              actor_type: 'system',
            });
          }
        }
      }

      const { error: updateError } = await adminClient.from('passenger_requests').update(update).eq('id', ride.id);
      if (updateError) console.error('updating a ride after its flight lookup failed', updateError.message);
    }

    // Offers in which a member's time moved (and with it their ready time): checked again as a
    // whole. Still fits - rescored. No longer fits (someone would now wait longer than their
    // maximum, or the route no longer works) - dissolved, and its passengers go back to searching.
    let groupsRescored = 0;
    for (const groupId of groupsToRescore) {
      const { data: group } = await adminClient.from('taxi_groups').select('status, version').eq('id', groupId).maybeSingle();
      if (group?.status !== 'unconfirmed') continue;
      await rescoreGroup(adminClient, groupId, group.version);
      groupsRescored++;
    }

    return jsonResponse({
      ridesChecked: due.length,
      flightsLookedUp: lookups.size,
      groupsRescored,
      terminalsUpdated,
      removedForTerminal,
      conflictsFlagged,
      readyTimeConflicts,
    });
  } finally {
    await releaseLock(adminClient, LOCK_ID);
  }
}));
