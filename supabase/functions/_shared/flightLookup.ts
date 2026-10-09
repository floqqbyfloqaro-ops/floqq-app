// Shared by flight-status and recheck-landing-times: AeroAPI returns every scheduled occurrence
// of a flight number/ident under one lookup, with no year attached to the number itself. Airlines
// reuse flight numbers day to day, so picking "whichever occurrence is closest to right now" picks
// the wrong day's flight for anything booked more than a few hours out - anchor instead on the
// caller's own expected date (the passenger's chosen arrival date at request time, or the
// request's stored arrival_at when rechecking an existing one).
import { AIRPORT } from './constants.ts';
import { ArrivalTerminal, normalizeTerminal } from './terminalRule.ts';

export const AEROAPI_BASE_URL = 'https://aeroapi.flightaware.com/aeroapi';

export function pickBestFlight(flights: unknown, anchorMs: number): any | null {
  if (!Array.isArray(flights) || flights.length === 0) return null;
  return flights.reduce((best: any, flight: any) => {
    const flightRef = flight.scheduled_out ? new Date(flight.scheduled_out).getTime() : Infinity;
    const bestRef = best?.scheduled_out ? new Date(best.scheduled_out).getTime() : Infinity;
    return Math.abs(flightRef - anchorMs) < Math.abs(bestRef - anchorMs) ? flight : best;
  }, null);
}

// What the app uses of one flight.
export type FlightSnapshot = {
  // The actual landing time if it already happened, otherwise the live estimate, otherwise the
  // schedule.
  estimatedLanding: string | null;
  scheduledLanding: string | null;
  scheduledDeparture: string | null;
  landed: boolean;
  cancelled: boolean;
  // Only when the flight lands at this app's airport and the data names one of its terminals.
  terminal: ArrivalTerminal | null;
};

export function flightSnapshot(flight: any): FlightSnapshot {
  const destination = flight?.destination;
  const landsHere = destination?.code_iata === AIRPORT.code;
  return {
    estimatedLanding: flight?.actual_in ?? flight?.estimated_in ?? flight?.scheduled_in ?? null,
    scheduledLanding: flight?.scheduled_in ?? null,
    scheduledDeparture: flight?.scheduled_out ?? flight?.scheduled_off ?? null,
    landed: Boolean(flight?.actual_in ?? flight?.actual_on),
    cancelled: flight?.cancelled === true,
    terminal: landsHere ? normalizeTerminal(flight?.terminal_destination) : null,
  };
}

// One AeroAPI lookup. Null when the lookup failed or knows no such flight.
export async function lookupFlight(flightNumber: string, anchorMs: number, apiKey: string): Promise<FlightSnapshot | null> {
  const response = await fetch(`${AEROAPI_BASE_URL}/flights/${encodeURIComponent(flightNumber)}`, {
    headers: { 'x-apikey': apiKey },
  });
  if (!response.ok) return null;

  const data = await response.json();
  const flight = pickBestFlight(data?.flights, anchorMs);
  return flight ? flightSnapshot(flight) : null;
}
