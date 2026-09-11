import { supabase } from './supabase';

export type PassengerRequestInput = {
  flightNumber: string;
  arrivalAt: Date;
  destinationAddress: string;
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
    bags_count: input.bagsCount,
    max_wait_minutes: input.maxWaitMinutes,
  });

  return { error };
}
