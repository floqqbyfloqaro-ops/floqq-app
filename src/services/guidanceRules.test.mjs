// Run with: node --experimental-strip-types --test src/services/guidanceRules.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  arrowRotation,
  bearingDegrees,
  continuousRotation,
  distanceDisplay,
  distanceMeters,
  hasArrived,
  nextArrivalStreak,
  nextZoneState,
  normalizeDegrees,
  pointsTooClose,
  roundDistance,
  shortestTurn,
  smoothHeading,
} from './guidanceRules.ts';

// The agreed thresholds (GUIDANCE in src/constants.ts).
const CONFIG = {
  exactAccuracyMeters: 15,
  approxDistanceFactor: 2,
  zoneEnterMeters: 25,
  zoneExitMeters: 35,
  zoneMaxAccuracyMeters: 25,
  arrivedRadiusMeters: 10,
  arrivedMaxAccuracyMeters: 10,
  arrivedReadings: 2,
};

// Barcelona-El Prat, roughly. One degree of latitude is about 111.2 km everywhere.
const HERE = { lat: 41.2969, lng: 2.0785 };
const north = (meters) => ({ lat: HERE.lat + meters / 111_195, lng: HERE.lng });
const east = (meters) => ({ lat: HERE.lat, lng: HERE.lng + meters / (111_195 * Math.cos((HERE.lat * Math.PI) / 180)) });

const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label ?? ''} expected ~${expected}, got ${actual}`);

test('distance: metres along a meridian and along a parallel', () => {
  near(distanceMeters(HERE, north(100)), 100, 0.5);
  near(distanceMeters(HERE, east(250)), 250, 1);
  assert.equal(distanceMeters(HERE, HERE), 0);
});

test('bearing: the four compass directions', () => {
  near(bearingDegrees(HERE, north(100)), 0, 0.01, 'north');
  near(bearingDegrees(HERE, east(100)), 90, 0.01, 'east');
  near(bearingDegrees(HERE, north(-100)), 180, 0.01, 'south');
  near(bearingDegrees(HERE, east(-100)), 270, 0.01, 'west');
});

test('bearing: north-east is about 45 degrees and always within 0-360', () => {
  const northEast = { lat: north(100).lat, lng: east(100).lng };
  near(bearingDegrees(HERE, northEast), 45, 0.1);
  const northWest = { lat: north(100).lat, lng: east(-100).lng };
  near(bearingDegrees(HERE, northWest), 315, 0.1);
});

test('the arrow turns by bearing minus heading', () => {
  assert.equal(arrowRotation(90, 0), 90); // target east, facing north: arrow points right
  assert.equal(arrowRotation(90, 90), 0); // facing the target: arrow points up
  assert.equal(arrowRotation(0, 90), 270); // target north, facing east: arrow points left
  assert.equal(arrowRotation(10, 350), 20); // across north
});

test('angles are normalised to 0-360', () => {
  assert.equal(normalizeDegrees(370), 10);
  assert.equal(normalizeDegrees(-10), 350);
  assert.equal(normalizeDegrees(360), 0);
  assert.equal(normalizeDegrees(720.5), 0.5);
});

test('the shortest turn crosses north instead of going the long way round', () => {
  assert.equal(shortestTurn(350, 10), 20);
  assert.equal(shortestTurn(10, 350), -20);
  assert.equal(shortestTurn(359, 0), 1);
  assert.equal(shortestTurn(0, 359), -1);
  assert.equal(shortestTurn(90, 270), 180);
  assert.equal(shortestTurn(45, 45), 0);
});

test('heading smoothing moves a fraction of the way, along the shorter arc', () => {
  assert.equal(smoothHeading(null, 200, 0.25), 200);
  assert.equal(smoothHeading(100, 140, 0.25), 110);
  // 350 -> 10 is +20 degrees through north: a quarter of that is 355, not 265.
  assert.equal(smoothHeading(350, 10, 0.25), 355);
  // And on across the boundary.
  assert.equal(smoothHeading(358, 10, 0.5), 4);
  assert.equal(smoothHeading(2, 350, 0.5), 356);
});

test('the animated rotation never spins the long way round at 359 -> 0', () => {
  assert.equal(continuousRotation(359, 0), 360);
  assert.equal(continuousRotation(360, 5), 365);
  assert.equal(continuousRotation(1, 359), -1);
  assert.equal(continuousRotation(-1, 350), -10);
  // Many turns in: still the nearest equivalent angle.
  assert.equal(continuousRotation(725, 10), 730);
  for (const [current, target] of [[359, 0], [0, 359], [180, 181], [725, 10], [-370, 20]]) {
    assert.ok(Math.abs(continuousRotation(current, target) - current) <= 180);
  }
});

test('distance is rounded to 5 m below 100 m and to 10 m above', () => {
  assert.equal(roundDistance(42), 40);
  assert.equal(roundDistance(43), 45);
  assert.equal(roundDistance(97), 95);
  assert.equal(roundDistance(98), 100);
  assert.equal(roundDistance(104), 100);
  assert.equal(roundDistance(106), 110);
  assert.equal(roundDistance(254), 250);
  assert.equal(roundDistance(2), 0);
});

test('a good fix shows the distance as a number', () => {
  assert.deepEqual(distanceDisplay(42, 8, CONFIG), { kind: 'exact', meters: 40 });
  assert.deepEqual(distanceDisplay(42, 15, CONFIG), { kind: 'exact', meters: 40 });
  assert.deepEqual(distanceDisplay(8, 12, CONFIG), { kind: 'exact', meters: 10 });
});

test('a rough fix far away shows the arrow with an approximate distance', () => {
  // 250 m away with a 40 m fix: more than twice the accuracy.
  assert.deepEqual(distanceDisplay(250, 40, CONFIG), { kind: 'approx', meters: 250 });
  assert.deepEqual(distanceDisplay(81, 40, CONFIG), { kind: 'approx', meters: 80 });
});

test('a rough fix close by hides the arrow: photo and directions instead', () => {
  // Exactly twice the accuracy is not "more than twice".
  assert.deepEqual(distanceDisplay(80, 40, CONFIG), { kind: 'close' });
  assert.deepEqual(distanceDisplay(30, 40, CONFIG), { kind: 'close' });
  assert.deepEqual(distanceDisplay(31, 16, CONFIG), { kind: 'close' });
});

test('a fix without an accuracy is treated as the roughest one', () => {
  assert.deepEqual(distanceDisplay(5000, null, CONFIG), { kind: 'close' });
});

test('"almost there": entered at 25 m with a fix of 25 m or better', () => {
  assert.equal(nextZoneState(false, 26, 10, CONFIG), false);
  assert.equal(nextZoneState(false, 25, 10, CONFIG), true);
  assert.equal(nextZoneState(false, 20, 25, CONFIG), true);
  // Close, but the fix is too rough to say so.
  assert.equal(nextZoneState(false, 20, 26, CONFIG), false);
  assert.equal(nextZoneState(false, 5, null, CONFIG), false);
});

test('"almost there": left only beyond 35 m, measured accurately', () => {
  assert.equal(nextZoneState(true, 30, 10, CONFIG), true); // between 25 and 35: stays in
  assert.equal(nextZoneState(true, 35, 10, CONFIG), true);
  assert.equal(nextZoneState(true, 36, 10, CONFIG), false);
  assert.equal(nextZoneState(true, 36, 25, CONFIG), false);
});

test('"almost there": a fix that got worse never pushes the passenger out', () => {
  assert.equal(nextZoneState(true, 60, 40, CONFIG), true);
  assert.equal(nextZoneState(true, 500, null, CONFIG), true);
  // No flicker over a noisy walk-in: in at 24 m, then readings jumping around the line.
  let inZone = false;
  const readings = [[40, 10], [24, 10], [27, 10], [33, 10], [45, 60], [26, 10], [34, 30]];
  const states = readings.map(([distance, accuracy]) => (inZone = nextZoneState(inZone, distance, accuracy, CONFIG)));
  assert.deepEqual(states, [false, true, true, true, true, true, true]);
});

test('automatic arrival needs two readings in a row within 10 m and accurate to 10 m', () => {
  let streak = 0;
  streak = nextArrivalStreak(streak, 8, 9, CONFIG);
  assert.equal(hasArrived(streak, CONFIG), false);
  streak = nextArrivalStreak(streak, 10, 10, CONFIG);
  assert.equal(hasArrived(streak, CONFIG), true);
});

test('automatic arrival: one bad reading in between starts the count again', () => {
  let streak = nextArrivalStreak(0, 8, 9, CONFIG);
  streak = nextArrivalStreak(streak, 11, 9, CONFIG); // just outside the radius
  assert.equal(streak, 0);
  streak = nextArrivalStreak(streak, 8, 9, CONFIG);
  assert.equal(hasArrived(streak, CONFIG), false);
});

test('automatic arrival never happens with a fix rougher than the radius', () => {
  let streak = 0;
  for (let i = 0; i < 20; i++) streak = nextArrivalStreak(streak, 1, 11, CONFIG);
  assert.equal(hasArrived(streak, CONFIG), false);
  for (let i = 0; i < 20; i++) streak = nextArrivalStreak(streak, 0, null, CONFIG);
  assert.equal(hasArrived(streak, CONFIG), false);
});

const placed = (short_code, terminal, position, is_active = true) => ({
  id: short_code,
  short_code,
  terminal,
  is_active,
  latitude: position?.lat ?? null,
  longitude: position?.lng ?? null,
});

test('two active points in the same terminal closer than 30 m are reported', () => {
  const pairs = pointsTooClose([placed('T1-A', 'T1', HERE), placed('T1-B', 'T1', north(18)), placed('T1-C', 'T1', north(80))], 30);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a.short_code, pairs[0].b.short_code], ['T1-A', 'T1-B']);
  near(pairs[0].meters, 18, 0.5);
});

test('points 30 m or more apart, in other terminals, inactive or without coordinates are fine', () => {
  assert.equal(pointsTooClose([placed('T1-A', 'T1', HERE), placed('T1-B', 'T1', north(31))], 30).length, 0);
  assert.equal(pointsTooClose([placed('T1-A', 'T1', HERE), placed('T2-A', 'T2B', north(5))], 30).length, 0);
  assert.equal(pointsTooClose([placed('T1-A', 'T1', HERE), placed('T1-B', 'T1', north(5), false)], 30).length, 0);
  assert.equal(pointsTooClose([placed('T1-A', 'T1', HERE), placed('T1-B', 'T1', null)], 30).length, 0);
});
