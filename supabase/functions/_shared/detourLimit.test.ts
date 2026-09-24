// Run with: node --experimental-strip-types --test supabase/functions/_shared/detourLimit.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allowedDetourMinutes, exceedsDetourLimit } from './detourLimit.ts';

// Pilot values from constants.ts (2026-09-24).
const LIMITS = { maxMinutes: 15, maxPercent: 50, minAllowedMinutes: 5 };

test('short trip is capped by the percentage (Castelldefels, ~15 min direct -> 7.5 min)', () => {
  assert.equal(allowedDetourMinutes(15, LIMITS), 7.5);
});

test('mid-length trip is capped by the percentage (Plaça Catalunya, ~22 min direct -> 11 min)', () => {
  assert.equal(allowedDetourMinutes(22, LIMITS), 11);
});

test('long trip is capped by the absolute limit (Sitges, ~35 min direct -> 15 min)', () => {
  assert.equal(allowedDetourMinutes(35, LIMITS), 15);
});

test('very short trip never drops below the floor', () => {
  assert.equal(allowedDetourMinutes(6, LIMITS), 5);
});

test('unknown direct time falls back to the absolute limit', () => {
  assert.equal(allowedDetourMinutes(null, LIMITS), 15);
  assert.equal(allowedDetourMinutes(undefined, LIMITS), 15);
});

test('exceedsDetourLimit is per passenger: exactly at the limit passes, over it fails', () => {
  assert.equal(exceedsDetourLimit({ extraDetourMinutes: 7.5, directMinutes: 15 }, LIMITS), false);
  assert.equal(exceedsDetourLimit({ extraDetourMinutes: 7.6, directMinutes: 15 }, LIMITS), true);
});
