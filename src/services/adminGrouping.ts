import { supabase } from './supabase';
import type { ArrivalTimeSource } from './passengerRequests';

export type PendingPassengerRequest = {
  id: string;
  passenger_name: string | null;
  flight_number: string;
  arrival_at: string;
  arrival_time_source: ArrivalTimeSource | null;
  created_at: string;
  destination_address: string;
  bags_count: number;
  max_wait_minutes: number;
  destination_lat: number | null;
  destination_lng: number | null;
};

// The admin dashboard's "Active" list: only requests still being searched/matched. Grouped
// ('matched') requests move out of this list into the groups section instead - see
// fetchTaxiGroups. Terminal requests ('cancelled', 'expired') never appear here; they live in the
// History tab via fetchHistoryRequests.
export function fetchPendingRequests() {
  return supabase
    .from('passenger_requests')
    .select(
      'id, passenger_name, flight_number, arrival_at, arrival_time_source, created_at, destination_address, bags_count, max_wait_minutes, destination_lat, destination_lng'
    )
    .eq('status', 'pending')
    .order('arrival_at', { ascending: true });
}

export type PassengerRequestHistoryStatus = 'cancelled' | 'expired';

export type HistoryPassengerRequest = {
  id: string;
  passenger_name: string | null;
  flight_number: string;
  arrival_at: string;
  arrival_time_source: ArrivalTimeSource | null;
  created_at: string;
  destination_address: string;
  bags_count: number;
  max_wait_minutes: number;
  status: PassengerRequestHistoryStatus;
};

// The admin dashboard's "History" tab: requests that reached a terminal state. Never deletes the
// underlying row (kept for pilot analytics) - this is a read-only filtered view.
export function fetchHistoryRequests() {
  return supabase
    .from('passenger_requests')
    .select(
      'id, passenger_name, flight_number, arrival_at, arrival_time_source, created_at, destination_address, bags_count, max_wait_minutes, status'
    )
    .in('status', ['cancelled', 'expired'])
    .order('arrival_at', { ascending: false })
    .returns<HistoryPassengerRequest[]>();
}

export async function createTaxiGroup(requestIds: string[]) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { data: null, error: new Error('You must be logged in.') };
  }

  const { data: group, error: groupError } = await supabase
    .from('taxi_groups')
    .insert({ created_by: user.id })
    .select('id')
    .single();

  if (groupError || !group) {
    return { data: null, error: groupError ?? new Error('Failed to create group.') };
  }

  const { error: updateError } = await supabase
    .from('passenger_requests')
    .update({ group_id: group.id, status: 'matched' })
    .in('id', requestIds);

  if (updateError) {
    return { data: null, error: updateError };
  }

  return { data: group, error: null };
}

export type TaxiGroupStatus = 'unconfirmed' | 'confirmed' | 'dissolved';

export type TaxiGroupSummary = {
  id: string;
  created_at: string;
  total_fare: number | null;
  status: TaxiGroupStatus;
};

const ACTIVE_GROUP_STATUSES: TaxiGroupStatus[] = ['unconfirmed', 'confirmed'];
export const HISTORY_GROUP_STATUSES: TaxiGroupStatus[] = ['dissolved'];

// Defaults to the admin dashboard's "Active" list (unconfirmed/confirmed groups). Pass
// HISTORY_GROUP_STATUSES for the History tab's dissolved groups - never both, so old groups
// don't pile up forever in the Active view.
export function fetchTaxiGroups(statuses: TaxiGroupStatus[] = ACTIVE_GROUP_STATUSES) {
  return supabase
    .from('taxi_groups')
    .select('id, created_at, total_fare, status')
    .in('status', statuses)
    .order('created_at', { ascending: false });
}

export function fetchGroupById(groupId: string) {
  return supabase.from('taxi_groups').select('id, created_at, total_fare, status, payer_request_id, payer_user_id, payer_status')
    .eq('id', groupId)
    .single();
}

// Payments prototype, phase 4: the designated payer's payout setup (admin can read every profile).
export function fetchPayoutStatusForUser(userId: string) {
  return supabase
    .from('user_payment_profiles')
    .select('payout_onboarding_status')
    .eq('user_id', userId)
    .maybeSingle<{ payout_onboarding_status: string }>();
}

export type TaxiGroupMember = {
  id: string;
  passenger_name: string | null;
  flight_number: string;
  arrival_at: string;
  arrival_time_source: ArrivalTimeSource | null;
  created_at: string;
  destination_address: string;
  bags_count: number;
  distance_km: number | null;
  extra_detour_minutes: number | null;
  waiting_minutes: number | null;
  individual_score: number | null;
};

export function fetchGroupMembers(groupId: string) {
  return supabase
    .from('passenger_requests')
    .select(
      'id, passenger_name, flight_number, arrival_at, arrival_time_source, created_at, destination_address, bags_count, distance_km, extra_detour_minutes, waiting_minutes, individual_score'
    )
    .eq('group_id', groupId);
}

export type GroupMemberArrival = { group_id: string; arrival_at: string };

// The admin dashboard's Groups list shows each group's ride date/time (its earliest member's
// arrival) next to when the group itself was created. Only meaningful for groups whose members
// are still attached via group_id - a dissolved group's members have already been detached, so
// this is only called for the Active tab's unconfirmed/confirmed groups.
export function fetchGroupMemberArrivals(groupIds: string[]) {
  if (groupIds.length === 0) {
    return Promise.resolve({ data: [] as GroupMemberArrival[], error: null });
  }
  return supabase.from('passenger_requests').select('group_id, arrival_at').in('group_id', groupIds).returns<GroupMemberArrival[]>();
}

export function updatePassengerDistance(requestId: string, distanceKm: number) {
  return supabase.from('passenger_requests').update({ distance_km: distanceKm }).eq('id', requestId);
}

export function updateGroupTotalFare(groupId: string, totalFare: number) {
  return supabase.from('taxi_groups').update({ total_fare: totalFare }).eq('id', groupId);
}

export function confirmTaxiGroup(groupId: string) {
  return supabase.from('taxi_groups').update({ status: 'confirmed' as TaxiGroupStatus }).eq('id', groupId);
}

export type GroupCorrectionBlockedReason = 'group_confirmed' | 'not_a_member' | 'not_found';

export type GroupCorrectionResult = {
  error: Error | null;
  blockedReason?: GroupCorrectionBlockedReason;
};

async function blockedReasonFromError(error: unknown): Promise<string | undefined> {
  const context = (error as { context?: Response }).context;
  if (!context) return undefined;
  try {
    const body = await context.json();
    return typeof body?.error === 'string' ? body.error : undefined;
  } catch {
    return undefined;
  }
}

// Removes one member from a group that isn't yet confirmed, resetting them to 'pending' and
// rebalancing (or dissolving) the group for whoever's left - the admin-initiated counterpart to a
// passenger editing themselves out (see passengerRequests.ts's updatePassengerRequest and
// supabase/functions/admin-manage-group).
export async function removeGroupMember(groupId: string, requestId: string): Promise<GroupCorrectionResult> {
  const { error } = await supabase.functions.invoke('admin-manage-group', {
    body: { action: 'remove', groupId, requestId },
  });
  if (!error) return { error: null };
  return { error, blockedReason: (await blockedReasonFromError(error)) as GroupCorrectionBlockedReason | undefined };
}

// Dissolves a group that isn't yet confirmed: every member goes back to 'pending'.
export async function dissolveGroup(groupId: string): Promise<GroupCorrectionResult> {
  const { error } = await supabase.functions.invoke('admin-manage-group', {
    body: { action: 'dissolve', groupId },
  });
  if (!error) return { error: null };
  return { error, blockedReason: (await blockedReasonFromError(error)) as GroupCorrectionBlockedReason | undefined };
}

export type AddGroupMemberBlockedReason =
  | GroupCorrectionBlockedReason
  | 'group_full'
  | 'request_not_available'
  | 'missing_coordinates'
  | 'route_computation_failed'
  | 'stale';

export type AddGroupMemberResult = {
  error: Error | null;
  blockedReason?: AddGroupMemberBlockedReason;
  // Returned instead of an error when the passenger would break a compatibility rule (detour,
  // wait, or luggage) - the admin can retry the same call with force: true to add them anyway.
  warning?: { worstIndividualScore: number };
  forced?: boolean;
};

// Adds a pending, ungrouped passenger to a group that isn't yet confirmed, respecting the max
// group size and the same compatibility rules used to form groups in the first place. Pass
// force: true to add the passenger despite a compatibility warning (the admin has already been
// shown it and chosen to proceed).
export async function addGroupMember(groupId: string, requestId: string, force = false): Promise<AddGroupMemberResult> {
  const { data, error } = await supabase.functions.invoke('admin-manage-group', {
    body: { action: 'add', groupId, requestId, force },
  });

  if (error) {
    return { error, blockedReason: (await blockedReasonFromError(error)) as AddGroupMemberBlockedReason | undefined };
  }

  const result = data as { ok: boolean; warning?: boolean; worstIndividualScore?: number; forced?: boolean };
  if (result?.warning) {
    return { error: null, warning: { worstIndividualScore: result.worstIndividualScore ?? 0 } };
  }

  return { error: null, forced: result?.forced };
}
