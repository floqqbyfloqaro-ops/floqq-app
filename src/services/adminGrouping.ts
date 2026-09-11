import { supabase } from './supabase';

export type PendingPassengerRequest = {
  id: string;
  flight_number: string;
  arrival_at: string;
  destination_address: string;
  bags_count: number;
  max_wait_minutes: number;
};

export function fetchPendingRequests() {
  return supabase
    .from('passenger_requests')
    .select('id, flight_number, arrival_at, destination_address, bags_count, max_wait_minutes')
    .eq('status', 'pending')
    .order('arrival_at', { ascending: true });
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

export type TaxiGroupSummary = {
  id: string;
  created_at: string;
  total_fare: number | null;
};

export function fetchTaxiGroups() {
  return supabase
    .from('taxi_groups')
    .select('id, created_at, total_fare')
    .order('created_at', { ascending: false });
}

export function fetchGroupById(groupId: string) {
  return supabase.from('taxi_groups').select('id, created_at, total_fare').eq('id', groupId).single();
}

export type TaxiGroupMember = {
  id: string;
  flight_number: string;
  destination_address: string;
  bags_count: number;
  distance_km: number | null;
};

export function fetchGroupMembers(groupId: string) {
  return supabase
    .from('passenger_requests')
    .select('id, flight_number, destination_address, bags_count, distance_km')
    .eq('group_id', groupId);
}

export function updatePassengerDistance(requestId: string, distanceKm: number) {
  return supabase.from('passenger_requests').update({ distance_km: distanceKm }).eq('id', requestId);
}

export function updateGroupTotalFare(groupId: string, totalFare: number) {
  return supabase.from('taxi_groups').update({ total_fare: totalFare }).eq('id', groupId);
}
