// Ported from src/constants.ts for the Deno Edge Function runtime, which cannot import the
// Expo app's files directly. Keep both copies in sync when tuning these values.

export const ADMIN_EMAIL = 'floqqbyfloqaro@gmail.com';

// Kept in sync with src/constants.ts.
export const MAX_PASSENGERS_PER_TAXI = 3;
// Large luggage only - hand luggage (at most 2 per passenger) doesn't count towards it.
export const MAX_LARGE_LUGGAGE_PER_TAXI = 4;

export const AIRPORT = {
  code: 'BCN',
  name: 'Barcelona-El Prat',
  lat: 41.297078,
  lng: 2.08325,
};

export const CORRIDOR_METERS = 3000;

// See src/constants.ts for the full explanation - kept in sync with that copy. tariff1 is a
// linear fit against two real FreeNow quotes from Barcelona-El Prat T1 (2026-09-24): T1->Plaça
// Catalunya (~13.4 km, €38 midpoint) and T1->Badalona (~28.0 km, €60 midpoint). The airport
// supplement can't be isolated from both points starting at the airport, so it's folded into
// flagFallEur (airportSupplementEur is 0). tariff2 is an unverified ~10-20% scale-up, not fitted
// to a real night/weekend quote.
export const BARCELONA_TAXI_TARIFFS = {
  tariff1: {
    flagFallEur: 17.69,
    perKmEur: 1.51,
  },
  tariff2: {
    flagFallEur: 19.42,
    perKmEur: 1.82,
  },
  airportSupplementEur: 0,
  minimumFareEur: 7.5,
} as const;

export const GROUP_DEPARTURE_BUFFER_MINUTES = 10;

export const SCORE_WEIGHTS = {
  detourMinute: 1,
  waitMinute: 1,
  fareEuro: 2,
};

// Per-passenger detour limit - see src/constants.ts for the full explanation and
// _shared/detourLimit.ts for the rule itself.
export const MAX_DETOUR_MINUTES = 15;
export const MAX_DETOUR_PERCENT = 50;
export const MIN_ALLOWED_DETOUR_MINUTES = 5;

export const DETOUR_LIMITS = {
  maxMinutes: MAX_DETOUR_MINUTES,
  maxPercent: MAX_DETOUR_PERCENT,
  minAllowedMinutes: MIN_ALLOWED_DETOUR_MINUTES,
} as const;

export const SERVICE_FEE_EUR = 2.49;

// "Match found": how long passengers have to secure their spot in a group offered to them. When
// it runs out, whoever didn't answer is removed and goes back to searching (unless nobody
// answered - then the window starts again). Server-side only; the app shows the deadline it is
// given.
export const MATCH_OFFER_TIMEOUT_MINUTES = 60;
