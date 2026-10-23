// Run with: node --experimental-strip-types --test src/services/helpChips.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { chipsFor, rideStage } from './helpChips.ts';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const HOUR = 3_600_000;
const ride = (overrides = {}) => ({
  status: 'matched',
  arrivalAt: new Date(NOW + 10 * HOUR).toISOString(),
  readyAt: null,
  completedAt: null,
  groupStatus: 'confirmed',
  rideStartedAt: null,
  ...overrides,
});

test('the chips follow the ride: searching, matched, meetup, completed, none', () => {
  assert.deepEqual(chipsFor(rideStage(ride({ status: 'pending', groupStatus: null }), NOW)), ['why_no_match', 'change_ride']);
  assert.deepEqual(chipsFor(rideStage(ride({ groupStatus: 'unconfirmed' }), NOW)), ['fee', 'cancel']);
  assert.deepEqual(chipsFor(rideStage(ride(), NOW)), ['fee', 'cancel']);
  assert.deepEqual(chipsFor(rideStage(ride({ arrivalAt: new Date(NOW + HOUR).toISOString() }), NOW)), ['find_group', 'arrow']);
  assert.deepEqual(chipsFor(rideStage(ride({ rideStartedAt: new Date(NOW - HOUR).toISOString() }), NOW)), ['find_group', 'arrow']);
  assert.deepEqual(chipsFor(rideStage(ride({ completedAt: new Date(NOW - 2 * HOUR).toISOString() }), NOW)), ['refund', 'share_wrong']);
  assert.deepEqual(chipsFor(rideStage(null, NOW)), ['how_it_works', 'cost']);
});

test('a ride that ended more than a day ago, or was cancelled, is no longer the context', () => {
  assert.equal(rideStage(ride({ completedAt: new Date(NOW - 30 * HOUR).toISOString() }), NOW), 'none');
  assert.equal(rideStage(ride({ status: 'cancelled' }), NOW), 'none');
  assert.equal(rideStage(ride({ status: 'expired' }), NOW), 'none');
});

test('the ready time counts for the meetup, not the landing', () => {
  const landsSoonReadyLater = ride({ arrivalAt: new Date(NOW + 2 * HOUR).toISOString(), readyAt: new Date(NOW + 4 * HOUR).toISOString() });
  assert.equal(rideStage(landsSoonReadyLater, NOW), 'matched');
});

test('every chip has its question in every language, and a knowledge base answer on the server', () => {
  const server = readFileSync(new URL('../../supabase/functions/_shared/helpChatRules.ts', import.meta.url), 'utf8');
  const topics = ['why_no_match', 'change_ride', 'fee', 'cancel', 'find_group', 'arrow', 'refund', 'share_wrong', 'how_it_works', 'cost'];
  for (const language of ['en', 'fr', 'es']) {
    const texts = JSON.parse(readFileSync(new URL(`../i18n/locales/${language}.json`, import.meta.url), 'utf8'));
    for (const topic of topics) assert.equal(typeof texts.help.chip[topic], 'string', `${language}: ${topic}`);
  }
  for (const topic of topics) assert.match(server, new RegExp(`\\b${topic}:`), topic);
});
