// Caps how many passengers the admin can group into one taxi. Pilot value dropped from 4 to 3
// (2026-09-24) - kept in sync with supabase/functions/_shared/constants.ts.
export const MAX_PASSENGERS_PER_TAXI = 3;

// Caps total bags across a group so everything fits in one taxi's trunk.
export const MAX_BAGS_PER_TAXI = 4;

// Only this account can see and use the admin screen (also enforced server-side via RLS).
export const ADMIN_EMAIL = 'floqqbyfloqaro@gmail.com';

// Single fixed airport for the MVP matching engine.
export const AIRPORT = {
  code: 'BCN',
  name: 'Barcelona-El Prat',
  lat: 41.297078,
  lng: 2.08325,
};

// Matching engine layer 2: how far (in meters) a candidate's destination may stray
// from the straight line airport -> anchor passenger's destination to count as "same corridor".
export const CORRIDOR_METERS = 3000;

// Matching engine layer 4 + admin fare-split screen: estimated Barcelona taxi tariffs, used to
// estimate the total fare from distance + time of day instead of the admin looking up and typing
// a real metered fare after the ride.
//
// IMPORTANT: two failed attempts to reach a live official AMB/Institut Metropolità del Taxi
// tariff page mean these are NOT sourced from a government tariff sheet. tariff1 below is
// instead a linear fit against two real FreeNow quotes gathered on 2026-09-24, both from
// Barcelona-El Prat T1 (this app's fixed origin):
//   - T1 -> Plaça Catalunya (~13.4 km real route distance): €32-44 metered, midpoint €38
//   - T1 -> Badalona (~28.0 km real route distance): €51-69 metered, midpoint €60
// Solving flagFallEur + perKmEur * distanceKm for both points exactly reproduces €38 and €60.
// Since both points start at the airport, the airport supplement can't be isolated from the
// flag-fall - it's folded into flagFallEur (airportSupplementEur is 0 below, kept as a named
// field for clarity rather than removed). This is a real 2-point fit, not a guess, but it's still
// only a linear approximation - a real meter also factors in time stuck in traffic separately
// from distance, which is likely why one straight line can't hit both points exactly for every
// route. Get a third real quote at a very different distance (or find the actual tariff sheet) to
// sanity-check this further.
export const BARCELONA_TAXI_TARIFFS = {
  // Tariff 1: Monday-Friday, 08:00-20:00, non-holiday. Fitted - see above.
  tariff1: {
    flagFallEur: 17.69,
    perKmEur: 1.51,
  },
  // Tariff 2: nights (20:00-08:00), Saturdays, Sundays, and holidays. Scaled up from the fitted
  // Tariff 1 by the same ~10-20% relative gap as the original guess - NOT calibrated against a
  // real night/weekend quote. Get one to fit this properly.
  // Holidays aren't modeled here (no holiday calendar) - only the weekday/weekend + time-of-day
  // split, so a Tariff-2 public holiday that falls on a weekday will be under-priced.
  tariff2: {
    flagFallEur: 19.42,
    perKmEur: 1.82,
  },
  // Folded into flagFallEur above - kept as a separate field for documentation, not double-counted.
  airportSupplementEur: 0,
  // Regulated minimum fare - the metered calculation never charges less than this. Moot in
  // practice now that flagFallEur alone exceeds it, but left in as a defensive floor.
  minimumFareEur: 7.5,
} as const;

// Assumed buffer between the last passenger's arrival and actual taxi departure (curb/meetup time).
export const GROUP_DEPARTURE_BUFFER_MINUTES = 10;

// Linear weights used to scalarize each passenger's detour/wait/fare into one comparable score.
export const SCORE_WEIGHTS = {
  detourMinute: 1,
  waitMinute: 1,
  fareEuro: 2,
};

// Per-passenger detour limit (see src/services/detourLimit.ts). A candidate group is discarded
// outright if any single passenger's extra time exceeds the smaller of MAX_DETOUR_MINUTES and
// MAX_DETOUR_PERCENT of their own direct trip - never averaged across the group. The floor keeps
// short trips (e.g. ~15 min to Castelldefels) shareable. Pilot values, set loose on purpose
// (2026-09-24); tighten once there are enough passengers to still form groups.
export const MAX_DETOUR_MINUTES = 15;
export const MAX_DETOUR_PERCENT = 50;
export const MIN_ALLOWED_DETOUR_MINUTES = 5;

export const DETOUR_LIMITS = {
  maxMinutes: MAX_DETOUR_MINUTES,
  maxPercent: MAX_DETOUR_PERCENT,
  minAllowedMinutes: MIN_ALLOWED_DETOUR_MINUTES,
} as const;

// Fixed FLOQQ service fee charged per passenger once their taxi group is confirmed. This is
// separate from the taxi fare itself, which is still split via fareSplit.ts and settled directly
// between passengers/driver - no automatic splitting of that fare is handled by this app yet.
export const SERVICE_FEE_EUR = 2.49;

// Admin dashboard History tab: rows older than this are hidden by default (never deleted - the
// admin can still reveal them with "Show all history"). Pilot default; revisit once there's real
// History-tab volume to judge against.
export const ADMIN_HISTORY_DEFAULT_WINDOW_DAYS = 7;
