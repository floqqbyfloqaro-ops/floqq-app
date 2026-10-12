// Runs the 4-layer matching engine and creates taxi groups directly, with no human review -
// the automatic counterpart to the admin's manual "Suggest groups" flow in the app
// (src/screens/AdminScreen.tsx), which is untouched and keeps working independently.
//
// Invoked in two ways, both handled below:
//   1. On a schedule (every MATCHING_INTERVAL_MINUTES), by a pg_cron job calling this URL with
//      the `x-cron-secret` header.
//   2. On demand, by an admin (or curl, for testing) with a Supabase user JWT.
// Deployed with --no-verify-jwt since this file does its own auth check instead.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { isAuthorized } from '../_shared/auth.ts';
import { monitored } from '../_shared/jobRuns.ts';
import { joinOpenOffers } from '../_shared/lateJoin.ts';
import { acquireLock, releaseLock } from '../_shared/matchLock.ts';
import { suggestTaxiGroups } from '../_shared/matchingEngine.ts';
import { loadRejectionMemory, saveRejectionMemory } from '../_shared/matchRejections.ts';
import { announceOffer } from '../_shared/offers.ts';

const LOCK_ID = 1;

// Every run leaves a trace for the admin dashboard (_shared/jobRuns.ts).
Deno.serve(monitored('match-and-group', async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  if (!(await isAuthorized(req, adminClient))) {
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
    const { data: pending, error: pendingError } = await adminClient
      .from('passenger_requests')
      .select(
        'id, flight_number, arrival_at, destination_address, bags_count, large_luggage_count, max_wait_minutes, destination_lat, destination_lng, arrival_terminal'
      )
      .eq('status', 'pending')
      .order('arrival_at', { ascending: true });

    if (pendingError) {
      return new Response(JSON.stringify({ error: pendingError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // First fill free seats in groups that are still an offer; whoever fits nowhere goes on to
    // form new groups.
    // Scoring a combination is a paid route lookup. What was turned down recently and hasn't
    // changed since is skipped (_shared/matchRejectionRule.ts).
    const now = new Date();
    const memory = await loadRejectionMemory(adminClient, now);

    const joined = await joinOpenOffers(adminClient, pending ?? [], now, memory);
    const stillPending = (pending ?? []).filter((r) => !joined.has(r.id));

    const suggestions = await suggestTaxiGroups(adminClient, stillPending, memory);
    await saveRejectionMemory(adminClient, memory, now);

    const claimed = new Set<string>();
    let groupsCreated = 0;
    // What went wrong along the way without stopping the run - shown on the admin dashboard.
    const problems: string[] = [];

    for (const suggestion of suggestions) {
      if (suggestion.requestIds.some((id) => claimed.has(id))) continue;

      // Formed by the system: no created_by (that is for groups the admin makes by hand).
      const { data: group, error: groupError } = await adminClient.from('taxi_groups').insert({}).select('id').single();

      if (groupError || !group) {
        console.error('creating a group failed', groupError?.message);
        problems.push(`creating a group failed: ${groupError?.message ?? 'no group returned'}`);
        continue;
      }

      const totalFare = suggestion.members.reduce((sum, m) => sum + m.fareAmount, 0);

      const { error: membersError } = await adminClient
        .from('passenger_requests')
        .update({ group_id: group.id, status: 'matched' })
        .in('id', suggestion.requestIds);
      if (membersError) {
        // The database refused the group (e.g. its same-terminal rule): leave no empty group behind.
        console.error('placing passengers into a new group failed', membersError.message);
        problems.push(`placing passengers into a new group failed: ${membersError.message}`);
        await adminClient.from('taxi_groups').delete().eq('id', group.id);
        continue;
      }

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

      await adminClient
        .from('taxi_groups')
        .update({
          total_fare: totalFare,
          worst_individual_score: suggestion.worstIndividualScore,
          total_route_distance_km: suggestion.totalRouteDistanceKm,
          total_route_duration_minutes: suggestion.totalRouteDurationMinutes,
        })
        .eq('id', group.id);

      // The group is an offer now ("Match found"): start its response window and tell its
      // passengers (audit event match_offered).
      await announceOffer(adminClient, group.id);

      suggestion.requestIds.forEach((id) => claimed.add(id));
      groupsCreated++;
    }

    return new Response(
      JSON.stringify({ groupsCreated, joinedExistingGroups: joined.size, ...(problems.length ? { problems } : {}) }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } finally {
    await releaseLock(adminClient, LOCK_ID);
  }
}));
