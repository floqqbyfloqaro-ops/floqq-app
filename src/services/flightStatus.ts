import { supabase } from './supabase';

export type FlightLandingEstimate = {
  estimatedLandingAt: Date;
  scheduledLandingAt: Date | null;
};

// Calls the flight-status Edge Function (never AeroAPI directly - the key must stay server-side).
export async function fetchEstimatedLandingTime(flightNumber: string): Promise<FlightLandingEstimate | null> {
  if (!flightNumber.trim()) {
    return null;
  }

  const { data, error } = await supabase.functions.invoke('flight-status', {
    body: { flightNumber: flightNumber.trim() },
  });

  if (error || !data?.found || !data.estimatedLandingUtc) {
    return null;
  }

  return {
    estimatedLandingAt: new Date(data.estimatedLandingUtc),
    scheduledLandingAt: data.scheduledLandingUtc ? new Date(data.scheduledLandingUtc) : null,
  };
}
