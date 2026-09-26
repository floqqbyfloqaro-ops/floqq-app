// Phase B of the group-rebalance flow shared by edit-passenger-request and
// cancel-passenger-request: after the SQL phase A has detached one passenger from an unconfirmed
// group that still has 2+ members, recompute that group's score via Google Routes and hand it
// to apply_group_rescore (phase C). See 20260923010000_group_rebalance_on_edit.sql.

import type { createClient } from 'npm:@supabase/supabase-js@2';

import { DETOUR_LIMITS, MAX_BAGS_PER_TAXI } from './constants.ts';
import { buildGroupTotalsPayload, buildMemberScoresPayload, isGroupStillValid } from './groupRebalance.ts';
import { computeGroupScore, PendingPassengerRequest } from './matchingEngine.ts';

const MAX_RESCORE_ATTEMPTS = 3;

// Which group status the rescore applies to. Passenger edits/cancels and admin corrections only
// ever touch unconfirmed groups; the payments prototype also removes a passenger whose hold wasn't
// placed from a confirmed group (payments-sync-holds), through its own service-role-only RPC.
export type RescoreTarget = { rpc: string; groupStatus: 'unconfirmed' | 'confirmed' };

const UNCONFIRMED_TARGET: RescoreTarget = { rpc: 'apply_group_rescore', groupStatus: 'unconfirmed' };

// Recomputes the surviving group's score and either applies it or dissolves the group, retrying
// against fresh membership if apply_group_rescore reports the version moved on (a concurrent
// edit on the same group committed in between).
export async function rescoreGroup(
  adminClient: ReturnType<typeof createClient>,
  groupId: string,
  expectedVersion: number,
  target: RescoreTarget = UNCONFIRMED_TARGET
) {
  let version = expectedVersion;

  for (let attempt = 0; attempt < MAX_RESCORE_ATTEMPTS; attempt++) {
    const { data: members, error: membersError } = await adminClient
      .from('passenger_requests')
      .select('id, flight_number, arrival_at, destination_address, bags_count, max_wait_minutes, destination_lat, destination_lng')
      .eq('group_id', groupId);

    if (membersError || !members) return;

    const group = (members as PendingPassengerRequest[]).filter(
      (r): r is PendingPassengerRequest & { destination_lat: number; destination_lng: number } =>
        r.destination_lat != null && r.destination_lng != null
    );

    // Someone else's concurrent edit already shrank this below 2, or dissolved it outright -
    // nothing left for this attempt to do.
    if (group.length < 2) return;

    const suggestion = await computeGroupScore(group);
    const stillValid = isGroupStillValid(
      suggestion,
      group.map((r) => ({ id: r.id, bagsCount: r.bags_count, maxWaitMinutes: r.max_wait_minutes })),
      MAX_BAGS_PER_TAXI,
      DETOUR_LIMITS
    );

    const { data: applyResult, error: applyError } = await adminClient.rpc(target.rpc, {
      p_group_id: groupId,
      p_expected_version: version,
      p_still_valid: stillValid,
      p_member_scores: stillValid && suggestion ? buildMemberScoresPayload(suggestion) : [],
      p_group_totals: stillValid && suggestion ? buildGroupTotalsPayload(suggestion) : {},
    });

    if (applyError) return;
    if ((applyResult as { applied: boolean }).applied) return;

    const { data: freshGroup } = await adminClient.from('taxi_groups').select('version, status').eq('id', groupId).single();
    if (!freshGroup || freshGroup.status !== target.groupStatus) return;
    version = freshGroup.version;
  }
}
