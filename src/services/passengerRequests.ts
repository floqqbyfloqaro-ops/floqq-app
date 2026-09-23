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

  // Google OAuth populates 'full_name' or 'name' depending on provider; a plain email/password
  // sign-up sets 'full_name' explicitly (see SignUpScreen). Falls back to null (the admin UI
  // falls back to flight_number) rather than blocking the request over a missing display name.
  const passengerName = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? null) as string | null;

  const { error } = await supabase.from('passenger_requests').insert({
    user_id: user.id,
    passenger_name: passengerName,
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

export type EditablePassengerRequest = {
  id: string;
  status: 'pending' | 'matched' | 'cancelled';
  flight_number: string;
  arrival_at: string;
  destination_address: string;
  destination_lat: number | null;
  destination_lng: number | null;
  large_luggage_count: number;
  hand_luggage_count: number;
  max_wait_minutes: number;
};

// Used by NewRequestScreen to prefill the form in edit mode. Scoped to the caller's own row by
// the existing "Users can view their own passenger requests" RLS policy.
export async function fetchPassengerRequestById(requestId: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { data: null as EditablePassengerRequest | null, error: new Error('You must be logged in.') };
  }

  return supabase
    .from('passenger_requests')
    .select(
      'id, status, flight_number, arrival_at, destination_address, destination_lat, destination_lng, large_luggage_count, hand_luggage_count, max_wait_minutes'
    )
    .eq('id', requestId)
    .eq('user_id', user.id)
    .maybeSingle<EditablePassengerRequest>();
}

export type UpdatePassengerRequestResult = {
  error: Error | null;
  // Set when the edit was rejected because the request's group is already confirmed - the
  // caller should show findingMatch's edit-locked message instead of a generic error.
  blockedReason?: 'group_confirmed';
};

// Routed through the edit-passenger-request Edge Function rather than a plain client-side
// UPDATE: if this request belongs to an unconfirmed group, removing it and rebalancing (or
// dissolving) that group for whoever's left has to happen atomically and needs a Google Routes
// recalculation, which can't be done from a client-side call alone. See
// supabase/migrations/20260923010000_group_rebalance_on_edit.sql and
// supabase/functions/edit-passenger-request for the full flow.
export async function updatePassengerRequest(
  requestId: string,
  input: PassengerRequestInput
): Promise<UpdatePassengerRequestResult> {
  const { error } = await supabase.functions.invoke('edit-passenger-request', {
    body: {
      requestId,
      flightNumber: input.flightNumber,
      arrivalAt: input.arrivalAt.toISOString(),
      destinationAddress: input.destinationAddress,
      destinationLat: input.destinationLat,
      destinationLng: input.destinationLng,
      largeLuggageCount: input.largeLuggageCount,
      handLuggageCount: input.handLuggageCount,
      maxWaitMinutes: input.maxWaitMinutes,
    },
  });

  if (!error) {
    return { error: null };
  }

  // FunctionsHttpError exposes the raw Response on `.context`, so the function's JSON body
  // (e.g. { error: 'group_confirmed' }) is readable instead of just a generic failure.
  const context = (error as { context?: Response }).context;
  if (context) {
    try {
      const body = await context.json();
      if (body?.error === 'group_confirmed') {
        return { error, blockedReason: 'group_confirmed' };
      }
    } catch {
      // Fall through to the generic error below.
    }
  }

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
