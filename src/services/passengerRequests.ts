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
  status: 'pending' | 'matched' | 'cancelled' | 'expired';
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
  status: 'pending' | 'matched' | 'cancelled' | 'expired';
  group_id: string | null;
  service_fee_status: ServiceFeeStatus;
  destination_address: string;
  arrival_at: string;
  max_wait_minutes: number;
};

const MY_REQUEST_COLUMNS =
  'id, flight_number, status, group_id, service_fee_status, destination_address, arrival_at, max_wait_minutes';

// The ride MyRideScreen shows: the passenger's active ride if they have one, otherwise their most
// recent (cancelled/expired) one. Active first, not simply newest - otherwise a newer expired or
// cancelled row hides a still-active ride and offers "Request a ride" for a passenger who can't
// have a second one.
export async function fetchMyLatestRequest() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { data: null as MyPassengerRequest | null, error: new Error('You must be logged in.') };
  }

  const { data: active, error: activeError } = await fetchMyActiveRequest();
  if (activeError) {
    return { data: null as MyPassengerRequest | null, error: activeError };
  }

  const query = supabase.from('passenger_requests').select(MY_REQUEST_COLUMNS).eq('user_id', user.id);

  return active
    ? query.eq('id', active.id).maybeSingle<MyPassengerRequest>()
    : query.order('created_at', { ascending: false }).limit(1).maybeSingle<MyPassengerRequest>();
}

export type CancelPassengerRequestResult = {
  error: Error | null;
  // Set when the ride's group is already confirmed - the caller should not offer cancelling.
  blockedReason?: 'group_confirmed';
};

// Routed through the cancel-passenger-request Edge Function rather than a plain client-side
// UPDATE, for the same reason as updatePassengerRequest: a ride in an unconfirmed group has to be
// detached and that group rebalanced (or dissolved) for whoever's left.
export async function cancelPassengerRequest(requestId: string): Promise<CancelPassengerRequestResult> {
  const { error } = await supabase.functions.invoke('cancel-passenger-request', { body: { requestId } });

  if (!error) {
    return { error: null };
  }

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

export type MyActiveRequest = {
  id: string;
  group_id: string | null;
  group_status: 'unconfirmed' | 'confirmed' | 'dissolved' | null;
};

// The caller's one active ride, if any. "Active" is defined once in SQL (is_active_request) and
// shared with the insert trigger that enforces one active ride per passenger.
export function fetchMyActiveRequest() {
  return supabase.rpc('get_my_active_request').maybeSingle<MyActiveRequest>();
}

function hasPostgresErrorText(error: unknown, text: string) {
  const e = error as { message?: string; details?: string; hint?: string } | null;
  return [e?.message, e?.details, e?.hint].some((value) => value?.includes(text));
}

// Postgres error raised by the enforce_one_active_request insert trigger.
export function isActiveRideExistsError(error: unknown) {
  return hasPostgresErrorText(error, 'active_ride_exists');
}

// Postgres error raised by the enforce_verified_email_for_request insert trigger.
export function isEmailNotVerifiedError(error: unknown) {
  return hasPostgresErrorText(error, 'email_not_verified');
}

export type MyTaxiGroup = {
  id: string;
  status: 'unconfirmed' | 'confirmed' | 'dissolved';
};

export function fetchMyGroupStatus(groupId: string) {
  return supabase.from('taxi_groups').select('id, status').eq('id', groupId).single<MyTaxiGroup>();
}
