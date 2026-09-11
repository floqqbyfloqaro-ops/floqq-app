// Caps how many passengers the admin can group into one taxi.
export const MAX_PASSENGERS_PER_TAXI = 4;

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

// Matching engine layer 4: estimated fare formula used only for scoring suggestions
// (the real metered fare is still entered by the admin after the ride).
export const FARE_BASE_EUR = 3.5;
export const FARE_PER_KM_EUR = 1.2;

// Assumed buffer between the last passenger's arrival and actual taxi departure (curb/meetup time).
export const GROUP_DEPARTURE_BUFFER_MINUTES = 10;

// Linear weights used to scalarize each passenger's detour/wait/fare into one comparable score.
export const SCORE_WEIGHTS = {
  detourMinute: 1,
  waitMinute: 1,
  fareEuro: 2,
};

// A candidate group is discarded outright if any single passenger's extra detour exceeds this,
// regardless of how good the group's average looks.
export const MAX_DETOUR_MINUTES = 15;
