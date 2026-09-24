import { supabase } from './supabase';

export type PendingPassengerRequest = {
  id: string;
  passenger_name: string | null;
  flight_number: string;
  arrival_at: string;
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
      'id, passenger_name, flight_number, arrival_at, destination_address, bags_count, max_wait_minutes, destination_lat, destination_lng'
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
      'id, passenger_name, flight_number, arrival_at, destination_address, bags_count, max_wait_minutes, status'
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
  return supabase.from('taxi_groups').select('id, created_at, total_fare, status').eq('id', groupId).single();
}

export type TaxiGroupMember = {
  id: string;
  passenger_name: string | null;
  flight_number: string;
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
      'id, passenger_name, flight_number, destination_address, bags_count, distance_km, extra_detour_minutes, waiting_minutes, individual_score'
    )
    .eq('group_id', groupId);
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
