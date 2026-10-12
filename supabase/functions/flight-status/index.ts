// Looks up a flight's real-time status via FlightAware AeroAPI so the flight entry screen
// (src/screens/NewRequestScreen.tsx) can prefill the estimated landing time instead of relying
// solely on whatever arrival time the passenger guesses - and tells it the arrival terminal: the
// one the flight data names, otherwise the one the flight's airline lands at (airline_terminals).
//
// The AeroAPI key has no app-identity restriction option (unlike the Google Maps key), so it
// must never reach the client bundle - it lives only as this function's FLIGHTAWARE_API_KEY
// secret. Deployed with the default JWT verification (any logged-in app user may call this).
// The service-role client is only for the kept lookups and the airline table.
//
// expectedArrivalAt (the passenger's currently-selected arrival date) anchors which occurrence of
// a reused flight number/ident gets picked - see _shared/flightLookup.ts. Each lookup is paid, so
// one is kept per flight and day and reused.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { airlineCodeOf, airlineTerminal } from '../_shared/airlineTerminalRule.ts';
import { loadAirlineTerminals, recordTerminalMismatch } from '../_shared/airlineTerminals.ts';
import { airportDayKey, cachedLookupFlight, formCacheMaxAgeMs } from '../_shared/flightLookup.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const apiKey = Deno.env.get('FLIGHTAWARE_API_KEY');
  if (!apiKey) {
    return jsonResponse({ found: false, error: 'Flight lookup is not configured.' }, 500);
  }

  let flightNumber = '';
  let expectedArrivalAt: string | undefined;
  try {
    const body = await req.json();
    flightNumber = typeof body?.flightNumber === 'string' ? body.flightNumber.trim() : '';
    expectedArrivalAt = typeof body?.expectedArrivalAt === 'string' ? body.expectedArrivalAt : undefined;
  } catch {
    return jsonResponse({ found: false, error: 'Invalid request body.' }, 400);
  }

  if (!flightNumber) {
    return jsonResponse({ found: false, error: 'flightNumber is required.' }, 400);
  }

  // The passenger's currently-selected arrival date, so a reused flight number (e.g. a daily
  // route) resolves to the occurrence they actually mean instead of whichever one is nearest to
  // right now. Falls back to now only if the client didn't send a usable date.
  const anchorDate = expectedArrivalAt ? new Date(expectedArrivalAt) : null;
  const anchorMs = anchorDate && !Number.isNaN(anchorDate.getTime()) ? anchorDate.getTime() : Date.now();

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const [snapshot, airlines] = await Promise.all([
    cachedLookupFlight(adminClient, flightNumber, anchorMs, apiKey, formCacheMaxAgeMs(anchorMs, Date.now())).catch(
      (err) => {
        console.error('flight lookup failed', err);
        return null;
      }
    ),
    loadAirlineTerminals(adminClient),
  ]);

  // Another day's flight under the same number (the ride is further ahead than flight data
  // reaches) says which airline flies it, not when or where this one lands.
  const thisFlight = snapshot?.onExpectedDay ? snapshot : null;
  const airline = airlineTerminal(airlines, [snapshot?.operatorIata, airlineCodeOf(flightNumber)]);

  if (thisFlight?.terminal && airline && thisFlight.terminal !== airline.terminal) {
    await recordTerminalMismatch(adminClient, {
      airlineIata: airline.airline_iata,
      flightNumber,
      flightDate: airportDayKey(anchorMs),
      tableTerminal: airline.terminal,
      reportedTerminal: thisFlight.terminal,
    });
  }

  // Flight data wins over the airline table.
  const arrivalTerminal = thisFlight?.terminal ?? airline?.terminal ?? null;

  return jsonResponse({
    // A landing time for the passenger's own flight.
    found: Boolean(thisFlight?.estimatedLanding),
    // The flight number exists, whether or not its landing time for that day is known yet.
    flightKnown: Boolean(snapshot),
    estimatedLandingUtc: thisFlight?.estimatedLanding ?? null,
    scheduledLandingUtc: thisFlight?.scheduledLanding ?? null,
    // 'T1' / 'T2', or null when neither the flight data nor the airline table names one (the
    // passenger then chooses).
    arrivalTerminal,
    arrivalTerminalSource: thisFlight?.terminal ? 'flight' : airline ? 'airline' : null,
    operatorIata: snapshot?.operatorIata ?? null,
  });
});
