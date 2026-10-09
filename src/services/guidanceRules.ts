// The pure rules behind "Find your group" guidance: the arrow to the meeting point, the distance
// text, the "almost there" zone and the automatic arrival. No imports at all, so a plain Node test
// loads this file directly (guidanceRules.test.mjs).
//
// Meeting points are precise spots (a bar, an info desk) inside an arrivals hall, where GPS is at
// its worst - so every rule here weighs the distance against how accurate the fix claims to be,
// and prefers showing a photo and written directions over an arrow it can't trust.

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_METERS = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

// Great-circle (haversine) distance.
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Any angle as 0 <= degrees < 360.
export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

// The initial great-circle bearing from one point to another: 0 = north, 90 = east.
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeDegrees(toDegrees(Math.atan2(y, x)));
}

// The shortest way to turn from one angle to another: between -180 (exclusive) and 180.
export function shortestTurn(from: number, to: number): number {
  const turn = normalizeDegrees(to - from);
  return turn > 180 ? turn - 360 : turn;
}

// How far the arrow is rotated on screen: where the target lies (bearing) relative to where the
// phone points (heading).
export function arrowRotation(bearing: number, heading: number): number {
  return normalizeDegrees(bearing - heading);
}

// Low-pass filter for the compass, along the shorter arc: from 350 towards 10 it passes through
// 0, never back through 180. `factor` is how much of each new reading is taken (0-1).
export function smoothHeading(previous: number | null, next: number, factor: number): number {
  if (previous == null) return normalizeDegrees(next);
  return normalizeDegrees(previous + shortestTurn(previous, next) * factor);
}

// The value to animate the arrow to: the target angle expressed as the turn closest to where the
// arrow already is, so it may run past 360 or below 0 instead of ever spinning the long way round.
export function continuousRotation(current: number, target: number): number {
  return current + shortestTurn(current, target);
}

// Rounded for display: to 5 m below 100 m, to 10 m from there on.
export function roundDistance(meters: number): number {
  const step = meters < 100 ? 5 : 10;
  return Math.round(meters / step) * step;
}

export type GuidanceConfig = {
  // The distance is shown as a plain number only with a fix at least this accurate.
  exactAccuracyMeters: number;
  // With a rougher fix the arrow is still shown while the distance is more than this many times
  // the fix's accuracy; closer than that the arrow can't be trusted.
  approxDistanceFactor: number;
  // The "almost there" zone around the meeting point.
  zoneEnterMeters: number;
  zoneExitMeters: number;
  zoneMaxAccuracyMeters: number;
  // Automatic arrival.
  arrivedRadiusMeters: number;
  arrivedMaxAccuracyMeters: number;
  arrivedReadings: number;
};

export type DistanceDisplay =
  // A fix good enough to trust: arrow and "40 m away".
  | { kind: 'exact'; meters: number }
  // A rough fix, but far enough away that the direction still holds: arrow and "Approx. 250 m".
  | { kind: 'approx'; meters: number }
  // A rough fix this close to the point: no arrow - the photo and the written directions instead.
  | { kind: 'close' };

// A missing accuracy counts as the worst one.
const accuracyOf = (accuracy: number | null) => accuracy ?? Number.POSITIVE_INFINITY;

export function distanceDisplay(distance: number, accuracy: number | null, config: GuidanceConfig): DistanceDisplay {
  const reported = accuracyOf(accuracy);
  if (reported <= config.exactAccuracyMeters) return { kind: 'exact', meters: roundDistance(distance) };
  if (distance > config.approxDistanceFactor * reported) return { kind: 'approx', meters: roundDistance(distance) };
  return { kind: 'close' };
}

// Is the passenger in the "almost there" zone after this reading?
//   - In: within the enter distance, measured with a fix at least as accurate as the zone needs.
//   - Out: beyond the exit distance, measured just as accurately. A fix that got worse while
//     inside never pushes the passenger out - that would make the screen flicker between states.
export function nextZoneState(inZone: boolean, distance: number, accuracy: number | null, config: GuidanceConfig): boolean {
  if (accuracyOf(accuracy) > config.zoneMaxAccuracyMeters) return inZone;
  if (inZone) return distance <= config.zoneExitMeters;
  return distance <= config.zoneEnterMeters;
}

// Automatic arrival needs several readings in a row that are both close and accurate: how many
// such readings there have been after this one. Never with a fix rougher than the radius itself.
export function nextArrivalStreak(streak: number, distance: number, accuracy: number | null, config: GuidanceConfig): number {
  const isArrivalReading =
    distance <= config.arrivedRadiusMeters && accuracyOf(accuracy) <= config.arrivedMaxAccuracyMeters;
  return isArrivalReading ? streak + 1 : 0;
}

export function hasArrived(streak: number, config: GuidanceConfig): boolean {
  return streak >= config.arrivedReadings;
}

export type PlacedPoint = {
  id: string;
  short_code: string;
  terminal: string;
  is_active: boolean;
  latitude: number | null;
  longitude: number | null;
};

export type ClosePair = { a: PlacedPoint; b: PlacedPoint; meters: number };

// Pairs of ACTIVE points in the same terminal that are closer together than `minMeters`: the
// arrow can't reliably tell two such points apart.
export function pointsTooClose(points: PlacedPoint[], minMeters: number): ClosePair[] {
  const placed = points.filter((point) => point.is_active && point.latitude != null && point.longitude != null);
  const pairs: ClosePair[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.terminal !== b.terminal) continue;
      const meters = distanceMeters({ lat: a.latitude!, lng: a.longitude! }, { lat: b.latitude!, lng: b.longitude! });
      if (meters < minMeters) pairs.push({ a, b, meters });
    }
  }
  return pairs;
}
