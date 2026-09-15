import { supabase } from './supabase';

export type PassengerRequestInput = {
  flightNumber: string;
  arrivalAt: Date;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  bagsCount: number;
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
    bags_count: input.bagsCount,
    max_wait_minutes: input.maxWaitMinutes,
  });

  return { error };
}

export type ServiceFeeStatus = 'unpaid' | 'pending' | 'paid';

export type MyPassengerRequest = {
  id: string;
  flight_number: string;
  status: 'pending' | 'matched';
  group_id: string | null;
  service_fee_status: ServiceFeeStatus;
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
    .select('id, flight_number, status, group_id, service_fee_status')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<MyPassengerRequest>();
}

export type MyTaxiGroup = {
  id: string;
  status: 'unconfirmed' | 'confirmed';
};

export function fetchMyGroupStatus(groupId: string) {
  return supabase.from('taxi_groups').select('id, status').eq('id', groupId).single<MyTaxiGroup>();
}
