import { supabase } from './supabase';

export type PassengerRequestInput = {
  flightNumber: string;
  arrivalAt: Date;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  largeLuggageCount: number;
  handLuggageCount: number;
  maxWaitMinutes: number;
};

export async function createPassengerRequest(input: PassengerRequestInput) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: new Error('You must be logged in to submit a request.') };
  }

  const { error } = await supabase.from('passenger_requests').insert({
    user_id: user.id,
    flight_number: input.flightNumber,
    arrival_at: input.arrivalAt.toISOString(),
    destination_address: input.destinationAddress,
    destination_lat: input.destinationLat,
    destination_lng: input.destinationLng,
    large_luggage_count: input.largeLuggageCount,
    hand_luggage_count: input.handLuggageCount,
    max_wait_minutes: input.maxWaitMinutes,
  });

  return { error };
}

export type ServiceFeeStatus = 'unpaid' | 'pending' | 'paid';

export type MyPassengerRequest = {
  id: string;
  flight_number: string;
  status: 'pending' | 'matched' | 'cancelled';
  group_id: string | null;
  service_fee_status: ServiceFeeStatus;
  destination_address: string;
  arrival_at: string;
  max_wait_minutes: number;
};

// The passenger's own most recent request, used by MyRideScreen to show group/payment status.
export async function fetchMyLatestRequest() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { data: null as MyPassengerRequest | null, error: new Error('You must be logged in.') };
  }

  return supabase
    .from('passenger_requests')
    .select('id, flight_number, status, group_id, service_fee_status, destination_address, arrival_at, max_wait_minutes')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<MyPassengerRequest>();
}

// Scoped by the "Users can cancel their own passenger requests" RLS policy, which only allows
// this exact transition (auth.uid() = user_id and the new status is 'cancelled') - it can't be
// used to edit any other field on the row.
export function cancelPassengerRequest(requestId: string) {
  return supabase.from('passenger_requests').update({ status: 'cancelled' }).eq('id', requestId);
}

export type MyTaxiGroup = {
  id: string;
  status: 'unconfirmed' | 'confirmed';
};

export function fetchMyGroupStatus(groupId: string) {
  return supabase.from('taxi_groups').select('id, status').eq('id', groupId).single<MyTaxiGroup>();
}
