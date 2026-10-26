// Run with: node --experimental-strip-types --test src/services/onTheWayRules.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ON_THE_WAY_HOURS, rideInProgress } from './onTheWayRules.ts';

const STARTED = '2026-10-22T18:00:00Z';
const at = (iso) => new Date(iso).getTime();

test('a ride that started is in progress for 3 hours', () => {
  const ride = { groupStatus: 'confirmed', rideStartedAt: STARTED };
  assert.equal(rideInProgress(ride, at('2026-10-22T18:00:00Z')), true);
  assert.equal(rideInProgress(ride, at('2026-10-22T20:59:59Z')), true);
  assert.equal(ON_THE_WAY_HOURS, 3);
});

test('never for a confirmed ride that has not started yet', () => {
  assert.equal(rideInProgress({ groupStatus: 'confirmed', rideStartedAt: null }, at('2026-10-22T18:30:00Z')), false);
});

test('never for a completed ride (3 hours or more after the start)', () => {
  const ride = { groupStatus: 'confirmed', rideStartedAt: STARTED };
  assert.equal(rideInProgress(ride, at('2026-10-22T21:00:00Z')), false);
  assert.equal(rideInProgress(ride, at('2026-10-23T09:00:00Z')), false);
});

test('never without a confirmed group', () => {
  for (const groupStatus of [null, 'unconfirmed', 'dissolved']) {
    assert.equal(rideInProgress({ groupStatus, rideStartedAt: STARTED }, at('2026-10-22T18:30:00Z')), false, groupStatus);
  }
});

test('the On the way texts exist in every language, without the old payments-off variant', () => {
  for (const language of ['en', 'fr', 'es']) {
    const texts = JSON.parse(readFileSync(new URL(`../i18n/locales/${language}.json`, import.meta.url), 'utf8'));
    for (const key of ['on_the_way_title', 'on_the_way_subtitle', 'estimated_share', 'final_share_note', 'share_secured_info']) {
      assert.equal(typeof texts[key], 'string', `${language}: ${key}`);
    }
    assert.equal(texts.share_calculated_info, undefined, language);
  }
});

test('the On the way screen uses no location, compass or other sensor', () => {
  const screen = readFileSync(new URL('../screens/OnTheWayScreen.tsx', import.meta.url), 'utf8');
  for (const forbidden of [
    'expo-location',
    'expo-sensors',
    'useOwnLocation',
    'useLocationSharing',
    'useGuidance',
    'GuidanceArrow',
    'watchHeading',
    'watchPosition',
    'useKeepAwake',
  ]) {
    assert.equal(screen.includes(forbidden), false, forbidden);
  }
});

test('the taxi receipt ends it, even within the 3 hours', () => {
  const ride = { groupStatus: 'confirmed', rideStartedAt: STARTED, receiptReceivedAt: '2026-10-22T18:40:00Z' };
  assert.equal(rideInProgress(ride, at('2026-10-22T18:45:00Z')), false);
  // A rejected receipt is cleared on the server: until a new one comes in, it is on its way again.
  assert.equal(rideInProgress({ ...ride, receiptReceivedAt: null }, at('2026-10-22T18:45:00Z')), true);
});

test("\"I've arrived\" ends it for that passenger only", () => {
  const ride = { groupStatus: 'confirmed', rideStartedAt: STARTED };
  assert.equal(rideInProgress({ ...ride, completedAt: '2026-10-22T18:20:00Z' }, at('2026-10-22T18:25:00Z')), false);
  assert.equal(rideInProgress({ ...ride, completedAt: null }, at('2026-10-22T18:25:00Z')), true);
});
