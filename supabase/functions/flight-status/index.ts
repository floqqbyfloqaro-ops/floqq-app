// Looks up a flight's real-time status via FlightAware AeroAPI so the flight entry screen
// (src/screens/NewRequestScreen.tsx) can prefill the estimated landing time instead of relying
// solely on whatever arrival time the passenger guesses.
//
// The AeroAPI key has no app-identity restriction option (unlike the Google Maps key), so it
// must never reach the client bundle - it lives only as this function's FLIGHTAWARE_API_KEY
// secret. Deployed with the default JWT verification (any logged-in app user may call this);
// unlike match-and-group, there's no cron path and no need for a service-role client here.

const AEROAPI_BASE_URL = 'https://aeroapi.flightaware.com/aeroapi';

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

// A flight number/ident can match several scheduled occurrences (past and future); pick the
// one whose scheduled departure is closest to now as the one the passenger actually means.
function pickBestFlight(flights: unknown): any | null {
  if (!Array.isArray(flights) || flights.length === 0) return null;
  const now = Date.now();
  return flights.reduce((best: any, flight: any) => {
    const flightRef = flight.scheduled_out ? new Date(flight.scheduled_out).getTime() : Infinity;
    const bestRef = best?.scheduled_out ? new Date(best.scheduled_out).getTime() : Infinity;
    return Math.abs(flightRef - now) < Math.abs(bestRef - now) ? flight : best;
  }, null);
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
  try {
    const body = await req.json();
    flightNumber = typeof body?.flightNumber === 'string' ? body.flightNumber.trim() : '';
  } catch {
    return jsonResponse({ found: false, error: 'Invalid request body.' }, 400);
  }

  if (!flightNumber) {
    return jsonResponse({ found: false, error: 'flightNumber is required.' }, 400);
  }

  const response = await fetch(`${AEROAPI_BASE_URL}/flights/${encodeURIComponent(flightNumber)}`, {
    headers: { 'x-apikey': apiKey },
  });

  if (!response.ok) {
    return jsonResponse({ found: false });
  }

  const data = await response.json();
  const flight = pickBestFlight(data?.flights);

  // Prefer the actual landing time if it already happened, otherwise the live estimate,
  // otherwise fall back to the schedule.
  const estimatedLandingUtc = flight ? flight.actual_in ?? flight.estimated_in ?? flight.scheduled_in ?? null : null;
  const scheduledLandingUtc = flight?.scheduled_in ?? null;

  if (!estimatedLandingUtc) {
    return jsonResponse({ found: false });
  }

  return jsonResponse({ found: true, estimatedLandingUtc, scheduledLandingUtc });
});
