// Shared by flight-status and recheck-landing-times: AeroAPI returns every scheduled occurrence
// of a flight number/ident under one lookup, with no year attached to the number itself. Airlines
// reuse flight numbers day to day, so picking "whichever occurrence is closest to right now" picks
// the wrong day's flight for anything booked more than a few hours out - anchor instead on the
// caller's own expected date (the passenger's chosen arrival date at request time, or the
// request's stored arrival_at when rechecking an existing one).
//
// AeroAPI only knows flights from about ten days back to two days ahead. For a ride further out
// the closest occurrence is another day's flight: it still tells which airline operates the
// flight number, but its times and terminal are not this ride's (onExpectedDay is false).
import { AIRPORT, FLIGHT_LOOKUP_CACHE } from './constants.ts';
import { normalizeTerminal } from './terminalRule.ts';
import type { ArrivalTerminal } from './terminalRule.ts';

export const AEROAPI_BASE_URL = 'https://aeroapi.flightaware.com/aeroapi';

const AIRPORT_TIME_ZONE = 'Europe/Madrid';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

// A landing just past midnight still belongs to an arrival entered for late the evening before.
const SAME_DAY_SLACK_MS = 3 * HOUR_MS;

export function pickBestFlight(flights: unknown, anchorMs: number): any | null {
  if (!Array.isArray(flights) || flights.length === 0) return null;
  return flights.reduce((best: any, flight: any) => {
    const flightRef = flight.scheduled_out ? new Date(flight.scheduled_out).getTime() : Infinity;
    const bestRef = best?.scheduled_out ? new Date(best.scheduled_out).getTime() : Infinity;
    return Math.abs(flightRef - anchorMs) < Math.abs(bestRef - anchorMs) ? flight : best;
  }, null);
}

// The calendar day at the airport (YYYY-MM-DD).
export function airportDayKey(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: AIRPORT_TIME_ZONE }).format(new Date(ms));
}

// What the app uses of one flight.
export type FlightSnapshot = {
  // When the plane is at the GATE (FlightAware's "in" times - never its runway "on" times): the
  // actual gate arrival if it already happened, otherwise the live estimate, otherwise the
  // schedule. This is the ride's arrival time; its ready time is counted from it.
  estimatedLanding: string | null;
  scheduledLanding: string | null;
  scheduledDeparture: string | null;
  landed: boolean;
  cancelled: boolean;
  // Only when the flight lands at this app's airport and the data names one of its terminals.
  terminal: ArrivalTerminal | null;
  // The airline flying the plane ("VY"), which on a codeshare is not the one in the flight number.
  operatorIata: string | null;
  // Where the flight comes from ("BOS" / "KBOS"). The four-letter code tells the country, and with
  // it whether the passenger goes through passport control (the ride's ready time).
  originIata: string | null;
  originIcao: string | null;
  // False when this is another day's flight under the same number: only the operator and the
  // origin apply (the same number flies the same route).
  onExpectedDay: boolean;
};

const airportCode = (value: unknown, length: number): string | null =>
  typeof value === 'string' && value.trim().length === length ? value.trim().toUpperCase() : null;

export function flightSnapshot(flight: any, anchorMs: number): FlightSnapshot {
  const destination = flight?.destination;
  const landsHere = destination?.code_iata === AIRPORT.code;
  const estimatedLanding: string | null = flight?.actual_in ?? flight?.estimated_in ?? flight?.scheduled_in ?? null;
  const landingMs = estimatedLanding ? new Date(estimatedLanding).getTime() : null;
  return {
    estimatedLanding,
    scheduledLanding: flight?.scheduled_in ?? null,
    scheduledDeparture: flight?.scheduled_out ?? flight?.scheduled_off ?? null,
    landed: Boolean(flight?.actual_in ?? flight?.actual_on),
    cancelled: flight?.cancelled === true,
    terminal: landsHere ? normalizeTerminal(flight?.terminal_destination) : null,
    operatorIata: typeof flight?.operator_iata === 'string' && flight.operator_iata ? flight.operator_iata.toUpperCase() : null,
    originIata: airportCode(flight?.origin?.code_iata, 3),
    originIcao: airportCode(flight?.origin?.code_icao, 4),
    onExpectedDay:
      landingMs != null &&
      (airportDayKey(landingMs) === airportDayKey(anchorMs) || Math.abs(landingMs - anchorMs) <= SAME_DAY_SLACK_MS),
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
  return flight ? flightSnapshot(flight, anchorMs) : null;
}

// How old a kept lookup may be for the request form: a flight landing soon moves, one landing
// next week doesn't.
export function formCacheMaxAgeMs(anchorMs: number, nowMs: number): number {
  return Math.abs(anchorMs - nowMs) <= FLIGHT_LOOKUP_CACHE.nearWindowHours * HOUR_MS
    ? FLIGHT_LOOKUP_CACHE.nearMinutes * MINUTE_MS
    : FLIGHT_LOOKUP_CACHE.farHours * HOUR_MS;
}

export const JOB_CACHE_MAX_AGE_MS = FLIGHT_LOOKUP_CACHE.jobMinutes * MINUTE_MS;

// lookupFlight, but reusing the lookup kept for this flight and day (flight_lookups) when it is
// no older than maxAgeMs. An unknown flight is kept too, so it isn't paid for again and again.
export async function cachedLookupFlight(
  // deno-lint-ignore no-explicit-any
  adminClient: any,
  flightNumber: string,
  anchorMs: number,
  apiKey: string,
  maxAgeMs: number
): Promise<FlightSnapshot | null> {
  const flight = flightNumber.toUpperCase().replace(/\s/g, '');
  const flightDate = airportDayKey(anchorMs);

  const { data: kept } = await adminClient
    .from('flight_lookups')
    .select('fetched_at, snapshot')
    .eq('flight_number', flight)
    .eq('flight_date', flightDate)
    .maybeSingle();
  if (kept && Date.now() - new Date(kept.fetched_at).getTime() <= maxAgeMs) {
    return (kept.snapshot as FlightSnapshot | null) ?? null;
  }

  const snapshot = await lookupFlight(flight, anchorMs, apiKey);
  const { error } = await adminClient
    .from('flight_lookups')
    .upsert({ flight_number: flight, flight_date: flightDate, fetched_at: new Date().toISOString(), snapshot });
  if (error) console.warn('keeping a flight lookup failed', error.message);
  return snapshot;
}
