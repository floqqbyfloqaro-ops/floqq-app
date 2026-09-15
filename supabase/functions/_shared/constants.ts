// Ported from src/constants.ts for the Deno Edge Function runtime, which cannot import the
// Expo app's files directly. Keep both copies in sync when tuning these values.

export const ADMIN_EMAIL = 'floqqbyfloqaro@gmail.com';

export const MAX_PASSENGERS_PER_TAXI = 4;
export const MAX_BAGS_PER_TAXI = 4;

export const AIRPORT = {
  code: 'BCN',
  name: 'Barcelona-El Prat',
  lat: 41.297078,
  lng: 2.08325,
};

export const CORRIDOR_METERS = 3000;

export const FARE_BASE_EUR = 3.5;
export const FARE_PER_KM_EUR = 1.2;

export const GROUP_DEPARTURE_BUFFER_MINUTES = 10;

export const SCORE_WEIGHTS = {
  detourMinute: 1,
  waitMinute: 1,
  fareEuro: 2,
};

export const MAX_DETOUR_MINUTES = 15;

export const SERVICE_FEE_EUR = 2.49;
