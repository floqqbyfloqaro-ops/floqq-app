// Looks up a flight's real-time status via FlightAware AeroAPI so the flight entry screen
// (src/screens/NewRequestScreen.tsx) can prefill the estimated landing time instead of relying
// solely on whatever arrival time the passenger guesses.
//
// The AeroAPI key has no app-identity restriction option (unlike the Google Maps key), so it
// must never reach the client bundle - it lives only as this function's FLIGHTAWARE_API_KEY
// secret. Deployed with the default JWT verification (any logged-in app user may call this);
// unlike match-and-group, there's no cron path and no need for a service-role client here.
//
// expectedArrivalAt (the passenger's currently-selected arrival date) anchors which occurrence of
// a reused flight number/ident gets picked - see _shared/flightLookup.ts.

import { AEROAPI_BASE_URL, pickBestFlight } from '../_shared/flightLookup.ts';

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

  const response = await fetch(`${AEROAPI_BASE_URL}/flights/${encodeURIComponent(flightNumber)}`, {
    headers: { 'x-apikey': apiKey },
  });

  if (!response.ok) {
    return jsonResponse({ found: false });
  }

  const data = await response.json();
  const flight = pickBestFlight(data?.flights, anchorMs);

  // Prefer the actual landing time if it already happened, otherwise the live estimate,
  // otherwise fall back to the schedule.
  const estimatedLandingUtc = flight ? flight.actual_in ?? flight.estimated_in ?? flight.scheduled_in ?? null : null;
  const scheduledLandingUtc = flight?.scheduled_in ?? null;

  if (!estimatedLandingUtc) {
    return jsonResponse({ found: false });
  }

  return jsonResponse({ found: true, estimatedLandingUtc, scheduledLandingUtc });
});
