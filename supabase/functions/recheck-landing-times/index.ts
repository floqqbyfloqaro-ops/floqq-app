// Watches for FlightAware landing-time changes on passengers already placed into a taxi
// group, and refreshes that group's scoring when one is detected - the automatic follow-up
// to the initial flight lookup done at request-submission time (src/services/flightStatus.ts).
//
// Only groups with taxi_groups.status = 'unconfirmed' are touched; once an admin confirms a
// group (src/screens/GroupDetailScreen.tsx), it's locked in and this job leaves it alone.
// Invoked the same two ways as match-and-group (cron secret or admin JWT); deployed with
// --no-verify-jwt since this file does its own auth check via the shared helper.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { isAuthorized } from '../_shared/auth.ts';
import { ADMIN_EMAIL } from '../_shared/constants.ts';
import { AEROAPI_BASE_URL, pickBestFlight } from '../_shared/flightLookup.ts';
import { acquireLock, releaseLock } from '../_shared/matchLock.ts';
import { computeGroupScore, PendingPassengerRequest } from '../_shared/matchingEngine.ts';

const LOCK_ID = 2;

// Ignores sub-minute differences (formatting noise between polls) so a real schedule change
// is what actually triggers a rescore.
const LANDING_TIME_CHANGE_THRESHOLD_SECONDS = 60;

type GroupedRow = PendingPassengerRequest & { group_id: string };

// anchorMs is the member's own current arrival_at, not "now" - a reused flight number/ident
// (e.g. a daily route) would otherwise resolve to whichever occurrence is nearest to whenever
// this job happens to run, which can silently overwrite arrival_at with the wrong day's landing
// time. See _shared/flightLookup.ts.
async function fetchEstimatedLandingUtc(flightNumber: string, anchorMs: number, apiKey: string): Promise<string | null> {
  const response = await fetch(`${AEROAPI_BASE_URL}/flights/${encodeURIComponent(flightNumber)}`, {
    headers: { 'x-apikey': apiKey },
  });
  if (!response.ok) return null;

  const data = await response.json();
  const flight = pickBestFlight(data?.flights, anchorMs);
  if (!flight) return null;

  return flight.actual_in ?? flight.estimated_in ?? flight.scheduled_in ?? null;
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  if (!(await isAuthorized(req, adminClient, ADMIN_EMAIL))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!(await acquireLock(adminClient, LOCK_ID))) {
    return new Response(JSON.stringify({ skipped: true, reason: 'a run is already in progress' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const apiKey = Deno.env.get('FLIGHTAWARE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Flight lookup is not configured.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: rows, error: rowsError } = await adminClient
      .from('passenger_requests')
      .select(
        'id, flight_number, arrival_at, destination_address, bags_count, max_wait_minutes, destination_lat, destination_lng, group_id, taxi_groups!inner(status)'
      )
      .eq('taxi_groups.status', 'unconfirmed');

    if (rowsError) {
      return new Response(JSON.stringify({ error: rowsError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const groups = new Map<string, GroupedRow[]>();
    for (const row of (rows ?? []) as GroupedRow[]) {
      if (row.destination_lat == null || row.destination_lng == null || !row.group_id) continue;
      const members = groups.get(row.group_id) ?? [];
      members.push(row);
      groups.set(row.group_id, members);
    }

    let groupsRescored = 0;

    for (const [groupId, members] of groups) {
      const estimates = await Promise.all(
        members.map((m) => fetchEstimatedLandingUtc(m.flight_number, new Date(m.arrival_at).getTime(), apiKey))
      );

      let changed = false;
      const updatedMembers = members.map((member, index) => {
        const newEstimate = estimates[index];
        if (!newEstimate) return member;

        const diffSeconds = Math.abs(new Date(newEstimate).getTime() - new Date(member.arrival_at).getTime()) / 1000;
        if (diffSeconds <= LANDING_TIME_CHANGE_THRESHOLD_SECONDS) {
          return member;
        }

        changed = true;
        return { ...member, arrival_at: newEstimate };
      });

      if (!changed) continue;

      await Promise.all(
        updatedMembers.map((member, index) =>
          member.arrival_at !== members[index].arrival_at
            ? adminClient
                .from('passenger_requests')
                .update({ arrival_at: member.arrival_at, arrival_time_source: 'flight' })
                .eq('id', member.id)
            : Promise.resolve()
        )
      );

      const suggestion = await computeGroupScore(
        updatedMembers as (PendingPassengerRequest & { destination_lat: number; destination_lng: number })[]
      );
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

    return new Response(JSON.stringify({ groupsChecked: groups.size, groupsRescored }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    await releaseLock(adminClient, LOCK_ID);
  }
});
