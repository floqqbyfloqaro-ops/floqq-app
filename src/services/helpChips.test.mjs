// Run with: node --experimental-strip-types --test src/services/helpChips.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ALL_TOPICS, BOOK_NEW_RIDE, chipsFor, isFollowup, rideStage, TOPIC_GROUPS } from './helpChips.ts';

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

test('no ride: the general questions first', () => {
  assert.deepEqual(chipsFor(rideStage(null, NOW)), ['how_it_works', 'cost', 'who_pays', 'fare_split', 'is_it_safe', 'change_password']);
});

test('searching: why no match, change, cancel, delay, matching', () => {
  assert.deepEqual(chipsFor(rideStage(ride({ status: 'pending', groupStatus: null }), NOW)), ['why_no_match', 'change_ride', 'cancel', 'flight_delayed', 'how_matching']);
});

test('meeting the group (within 3 hours, or riding): the meetup questions', () => {
  const meetup = ['meeting_point', 'find_group', 'arrow', 'someone_missing', 'cancel'];
  assert.deepEqual(chipsFor(rideStage(ride({ arrivalAt: new Date(NOW + HOUR).toISOString() }), NOW)), meetup);
  assert.deepEqual(chipsFor(rideStage(ride({ rideStartedAt: new Date(NOW - HOUR).toISOString() }), NOW)), meetup);
});

test('a group found, not meeting yet: where and how to pay come first', () => {
  assert.deepEqual(chipsFor(rideStage(ride(), NOW))[0], 'meeting_point');
  assert.deepEqual(chipsFor(rideStage(ride({ groupStatus: 'unconfirmed' }), NOW)), chipsFor('matched'));
});

test('completed: refund, the split, a failed payment', () => {
  assert.deepEqual(chipsFor(rideStage(ride({ completedAt: new Date(NOW - 2 * HOUR).toISOString() }), NOW)), ['refund', 'fare_split', 'payment_failed']);
});

test('at most 7 situation chips (with "More topics", at most 8), all of them real topics', () => {
  for (const stage of ['none', 'searching', 'matched', 'meetup', 'completed']) {
    const chips = chipsFor(stage);
    assert.ok(chips.length <= 7, stage);
    for (const chip of chips) assert.ok(ALL_TOPICS.includes(chip), `${stage}: ${chip}`);
  }
});

test('"More topics": all 19, each in one theme', () => {
  assert.equal(ALL_TOPICS.length, 19);
  assert.equal(new Set(ALL_TOPICS).size, 19);
  assert.deepEqual(Object.keys(TOPIC_GROUPS), ['ride', 'meetup', 'money', 'account', 'general']);
});

test('follow-ups: a topic or "Book a new ride", nothing else', () => {
  assert.equal(isFollowup('who_pays'), true);
  assert.equal(isFollowup(BOOK_NEW_RIDE), true);
  assert.equal(isFollowup('refund_me_now'), false);
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

test('every chip has a short question in every language, and a knowledge base answer on the server', () => {
  const server = readFileSync(new URL('../../supabase/functions/_shared/helpChatRules.ts', import.meta.url), 'utf8');
  for (const language of ['en', 'fr', 'es']) {
    const texts = JSON.parse(readFileSync(new URL(`../i18n/locales/${language}.json`, import.meta.url), 'utf8'));
    for (const topic of [...ALL_TOPICS, BOOK_NEW_RIDE]) {
      const label = texts.help.chip[topic];
      assert.equal(typeof label, 'string', `${language}: ${topic}`);
      assert.ok(label.split(/\s+/).length <= 6, `${language}: "${label}" is short`);
    }
    for (const group of Object.keys(TOPIC_GROUPS)) assert.equal(typeof texts.help.topicGroup[group], 'string', `${language}: group ${group}`);
    assert.equal(typeof texts.help.moreTopics, 'string', `${language}: moreTopics`);
  }
  for (const topic of ALL_TOPICS) assert.match(server, new RegExp(`\\b${topic}:`), topic);
});
