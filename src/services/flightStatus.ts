import { supabase } from './supabase';
import type { ArrivalTerminal } from './terminalRules';

export type FlightLookup = {
  // Null when the flight's landing time for that day isn't known (yet): flight data only reaches
  // about two days ahead.
  estimatedLandingAt: Date | null;
  scheduledLandingAt: Date | null;
  // The flight number exists, whether or not its landing time is known.
  flightKnown: boolean;
  // Only when the flight data itself names the terminal. (The terminal of the flight's airline
  // is read from the airline table by the form itself - see airlineTerminals.ts.)
  flightTerminal: ArrivalTerminal | null;
  // The airline flying the plane, which on a codeshare is not the one in the flight number.
  operatorIata: string | null;
  // Where the flight comes from ("BOS" / "KBOS"): saved with the ride, for its ready time.
  originIata: string | null;
  originIcao: string | null;
};

// Calls the flight-status Edge Function (never AeroAPI directly - the key must stay server-side).
// expectedArrivalAt is the date the passenger currently has selected in the form - it anchors
// which occurrence of a reused flight number/ident the function picks, instead of whichever one
// happens to be closest to right now (see supabase/functions/_shared/flightLookup.ts). Null when
// the lookup itself failed.
export async function fetchFlightLookup(flightNumber: string, expectedArrivalAt: Date): Promise<FlightLookup | null> {
  if (!flightNumber.trim()) {
    return null;
  }

  const { data, error } = await supabase.functions.invoke('flight-status', {
    body: { flightNumber: flightNumber.trim(), expectedArrivalAt: expectedArrivalAt.toISOString() },
  });

  if (error || !data) {
    return null;
  }

  const isTerminal = data.arrivalTerminal === 'T1' || data.arrivalTerminal === 'T2';
  return {
    estimatedLandingAt: data.found && data.estimatedLandingUtc ? new Date(data.estimatedLandingUtc) : null,
    scheduledLandingAt: data.scheduledLandingUtc ? new Date(data.scheduledLandingUtc) : null,
    flightKnown: Boolean(data.flightKnown ?? data.found),
    flightTerminal: isTerminal && data.arrivalTerminalSource === 'flight' ? data.arrivalTerminal : null,
    operatorIata: typeof data.operatorIata === 'string' ? data.operatorIata : null,
    originIata: typeof data.originIata === 'string' ? data.originIata : null,
    originIcao: typeof data.originIcao === 'string' ? data.originIcao : null,
  };
}
