// Ported from src/services/googleRoutes.ts for the Deno Edge Function runtime.
// Keep both copies in sync. Reads the key from the GOOGLE_ROUTES_API_KEY function secret
// (set via `supabase secrets set`) instead of the app's EXPO_PUBLIC_ env var.

const GOOGLE_ROUTES_API_KEY = Deno.env.get('GOOGLE_ROUTES_API_KEY');

export type LatLng = {
  lat: number;
  lng: number;
};

export type RouteMatrixCell = {
  originIndex: number;
  destinationIndex: number;
  durationSec: number;
  distanceMeters: number;
};

function toWaypoint(point: LatLng) {
  return { waypoint: { location: { latLng: { latitude: point.lat, longitude: point.lng } } } };
}

function parseDurationSec(duration: unknown): number {
  if (typeof duration !== 'string') return 0;
  const seconds = Number.parseFloat(duration.replace('s', ''));
  return Number.isNaN(seconds) ? 0 : seconds;
}

// Computes real travel times between every pair of points (points used as both origins and
// destinations), so callers get airport->destination and destination->destination legs in one call.
export async function computeRouteMatrix(points: LatLng[]): Promise<RouteMatrixCell[]> {
  if (!GOOGLE_ROUTES_API_KEY || points.length < 2) {
    return [];
  }

  const response = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_ROUTES_API_KEY,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition,status',
    },
    body: JSON.stringify({
      origins: points.map(toWaypoint),
      destinations: points.map(toWaypoint),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }),
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  const rows: unknown[] = Array.isArray(data) ? data : [];

  return rows
    .filter((row: any) => row?.condition !== 'ROUTE_NOT_FOUND' && row?.status?.code === undefined)
    .map((row: any) => ({
      originIndex: row.originIndex ?? 0,
      destinationIndex: row.destinationIndex ?? 0,
      durationSec: parseDurationSec(row.duration),
      distanceMeters: row.distanceMeters ?? 0,
    }));
}
