import { supabase } from './supabase';

export type FlightLandingEstimate = {
  estimatedLandingAt: Date;
  scheduledLandingAt: Date | null;
};

// Calls the flight-status Edge Function (never AeroAPI directly - the key must stay server-side).
// expectedArrivalAt is the date the passenger currently has selected in the form - it anchors
// which occurrence of a reused flight number/ident the function picks, instead of whichever one
// happens to be closest to right now (see supabase/functions/_shared/flightLookup.ts).
export async function fetchEstimatedLandingTime(
  flightNumber: string,
  expectedArrivalAt: Date
): Promise<FlightLandingEstimate | null> {
  if (!flightNumber.trim()) {
    return null;
  }

  const { data, error } = await supabase.functions.invoke('flight-status', {
    body: { flightNumber: flightNumber.trim(), expectedArrivalAt: expectedArrivalAt.toISOString() },
  });

  if (error || !data?.found || !data.estimatedLandingUtc) {
    return null;
  }

  return {
    estimatedLandingAt: new Date(data.estimatedLandingUtc),
    scheduledLandingAt: data.scheduledLandingUtc ? new Date(data.scheduledLandingUtc) : null,
  };
}
