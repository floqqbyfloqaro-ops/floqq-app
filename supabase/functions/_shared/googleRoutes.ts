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

// The drawn route through these points in order (first = origin, last = destination), as a
// Google encoded polyline - for the "Match found" map. Null when Google has no route or the key
// is missing: the app shows a placeholder instead of a map.
export async function computeRoutePolyline(points: LatLng[]): Promise<string | null> {
  if (!GOOGLE_ROUTES_API_KEY || points.length < 2) {
    return null;
  }

  const toLocation = (point: LatLng) => ({ location: { latLng: { latitude: point.lat, longitude: point.lng } } });

  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_ROUTES_API_KEY,
      'X-Goog-FieldMask': 'routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: toLocation(points[0]),
      destination: toLocation(points[points.length - 1]),
      intermediates: points.slice(1, -1).map(toLocation),
      travelMode: 'DRIVE',
      polylineQuality: 'OVERVIEW',
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const encoded = data?.routes?.[0]?.polyline?.encodedPolyline;
  return typeof encoded === 'string' && encoded.length > 0 ? encoded : null;
}

// The neighbourhood-level name of a place ("Eixample", "Gràcia", or the town outside Barcelona) -
// what other passengers see instead of an address. Uses the same key, which must also allow the
// Geocoding API; null when it doesn't or Google has no such name.
export async function lookupNeighborhood(point: LatLng): Promise<string | null> {
  if (!GOOGLE_ROUTES_API_KEY) {
    return null;
  }

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?latlng=${point.lat},${point.lng}&language=ca&key=${GOOGLE_ROUTES_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  if (data?.status !== 'OK' || !Array.isArray(data.results)) {
    if (data?.status && data.status !== 'ZERO_RESULTS') console.warn('lookupNeighborhood failed', data.status);
    return null;
  }

  // District first (Barcelona's "Eixample"), then a smaller neighbourhood, then the town.
  for (const type of ['sublocality_level_1', 'sublocality', 'neighborhood', 'locality']) {
    for (const result of data.results) {
      const component = (result.address_components ?? []).find((c: any) => (c.types ?? []).includes(type));
      if (component?.long_name) return component.long_name as string;
    }
  }
  return null;
}
