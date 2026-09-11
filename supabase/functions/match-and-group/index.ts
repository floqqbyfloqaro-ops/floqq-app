// Runs the 4-layer matching engine and creates taxi groups directly, with no human review -
// the automatic counterpart to the admin's manual "Suggest groups" flow in the app
// (src/screens/AdminScreen.tsx), which is untouched and keeps working independently.
//
// Invoked in two ways, both handled below:
//   1. On a schedule, by a pg_cron job calling this URL with the `x-cron-secret` header.
//   2. On demand, by an admin (or curl, for testing) with a Supabase user JWT.
// Deployed with --no-verify-jwt since this file does its own auth check instead.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { isAuthorized } from '../_shared/auth.ts';
import { ADMIN_EMAIL } from '../_shared/constants.ts';
import { acquireLock, releaseLock } from '../_shared/matchLock.ts';
import { suggestTaxiGroups } from '../_shared/matchingEngine.ts';

const LOCK_ID = 1;

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
    const { data: users, error: usersError } = await adminClient.auth.admin.listUsers();
    const adminUser = users?.users.find((u) => u.email === ADMIN_EMAIL);
    if (usersError || !adminUser) {
      return new Response(JSON.stringify({ error: 'Admin account not found' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: pending, error: pendingError } = await adminClient
      .from('passenger_requests')
      .select(
        'id, flight_number, arrival_at, destination_address, bags_count, max_wait_minutes, destination_lat, destination_lng'
      )
      .eq('status', 'pending')
      .order('arrival_at', { ascending: true });

    if (pendingError) {
      return new Response(JSON.stringify({ error: pendingError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const suggestions = await suggestTaxiGroups(adminClient, pending ?? []);

    const claimed = new Set<string>();
    let groupsCreated = 0;

    for (const suggestion of suggestions) {
      if (suggestion.requestIds.some((id) => claimed.has(id))) continue;

      const { data: group, error: groupError } = await adminClient
        .from('taxi_groups')
        .insert({ created_by: adminUser.id })
        .select('id')
        .single();

      if (groupError || !group) continue;

      const totalFare = suggestion.members.reduce((sum, m) => sum + m.fareAmount, 0);

      await adminClient
        .from('passenger_requests')
        .update({ group_id: group.id, status: 'matched' })
        .in('id', suggestion.requestIds);

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

      suggestion.requestIds.forEach((id) => claimed.add(id));
      groupsCreated++;
    }

    return new Response(JSON.stringify({ groupsCreated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    await releaseLock(adminClient, LOCK_ID);
  }
});
