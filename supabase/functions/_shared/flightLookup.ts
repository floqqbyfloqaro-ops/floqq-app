// Shared by flight-status and recheck-landing-times: AeroAPI returns every scheduled occurrence
// of a flight number/ident under one lookup, with no year attached to the number itself. Airlines
// reuse flight numbers day to day, so picking "whichever occurrence is closest to right now" picks
// the wrong day's flight for anything booked more than a few hours out - anchor instead on the
// caller's own expected date (the passenger's chosen arrival date at request time, or the
// request's stored arrival_at when rechecking an existing one).
export const AEROAPI_BASE_URL = 'https://aeroapi.flightaware.com/aeroapi';

export function pickBestFlight(flights: unknown, anchorMs: number): any | null {
  if (!Array.isArray(flights) || flights.length === 0) return null;
  return flights.reduce((best: any, flight: any) => {
    const flightRef = flight.scheduled_out ? new Date(flight.scheduled_out).getTime() : Infinity;
    const bestRef = best?.scheduled_out ? new Date(best.scheduled_out).getTime() : Infinity;
    return Math.abs(flightRef - anchorMs) < Math.abs(bestRef - anchorMs) ? flight : best;
  }, null);
}
