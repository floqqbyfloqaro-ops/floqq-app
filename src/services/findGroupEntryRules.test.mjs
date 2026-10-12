// Run with: node --experimental-strip-types --test src/services/findGroupEntryRules.test.mjs
//
// A plain .mjs file on purpose: the app's own TypeScript check doesn't cover test files, and Node
// loads the .ts file under test directly.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findGroupEntryState, hasLanded, locationMayRun, shouldAutoOpen } from './findGroupEntryRules.ts';

const MINUTE = 60_000;
const LANDING = '2026-10-13T15:00:00Z';
const LANDING_MS = Date.parse(LANDING);
const DAY_BEFORE = LANDING_MS - 24 * 60 * MINUTE;

const meetup = (overrides = {}) => ({
  rideStartedAt: null,
  meetupCompletedAt: null,
  members: [
    { isMe: false, expectedLandingAt: '2026-10-13T14:30:00Z' },
    { isMe: true, expectedLandingAt: LANDING },
  ],
  ...overrides,
});

test('the button is hidden without a confirmed group (cancelled, dissolved, not confirmed yet)', () => {
  assert.equal(findGroupEntryState(null, LANDING_MS), 'hidden');
});

test('the button is hidden once the ride has started', () => {
  assert.equal(findGroupEntryState(meetup({ rideStartedAt: '2026-10-13T15:20:00Z' }), LANDING_MS + 30 * MINUTE), 'hidden');
});

test('the button is hidden for someone who is no longer in the group', () => {
  const others = meetup({ members: [{ isMe: false, expectedLandingAt: LANDING }] });
  assert.equal(findGroupEntryState(others, LANDING_MS), 'hidden');
});

test('a group confirmed the day before opens as a preview', () => {
  assert.equal(findGroupEntryState(meetup(), DAY_BEFORE), 'preview');
});

test('the preview lasts until the passenger’s own landing, not the first member’s', () => {
  // The other member landed half an hour ago; this passenger is still in the air.
  assert.equal(findGroupEntryState(meetup(), LANDING_MS - 10 * MINUTE), 'preview');
});

test('the preview never reads the location', () => {
  assert.equal(locationMayRun(findGroupEntryState(meetup(), DAY_BEFORE)), false);
  assert.equal(locationMayRun(findGroupEntryState(meetup(), LANDING_MS - MINUTE)), false);
  assert.equal(locationMayRun('hidden'), false);
});

test('landing switches the button to the highlighted state', () => {
  assert.equal(findGroupEntryState(meetup(), LANDING_MS), 'landed');
  assert.equal(findGroupEntryState(meetup(), LANDING_MS + 20 * MINUTE), 'landed');
});

test('once landed, the guidance may use the location', () => {
  assert.equal(locationMayRun(findGroupEntryState(meetup(), LANDING_MS)), true);
});

test('a delayed flight keeps the preview until its new landing time', () => {
  const delayed = meetup({
    members: [
      { isMe: false, expectedLandingAt: '2026-10-13T14:30:00Z' },
      { isMe: true, expectedLandingAt: '2026-10-13T16:10:00Z' },
    ],
  });
  assert.equal(findGroupEntryState(delayed, LANDING_MS + 30 * MINUTE), 'preview');
  assert.equal(findGroupEntryState(delayed, Date.parse('2026-10-13T16:10:00Z')), 'landed');
});

test('a member has landed from their expected landing on', () => {
  assert.equal(hasLanded(LANDING, LANDING_MS - 1), false);
  assert.equal(hasLanded(LANDING, LANDING_MS), true);
});

test('opening the app after landing goes straight to the meetup', () => {
  assert.equal(shouldAutoOpen(meetup(), LANDING_MS + MINUTE, false), true);
});

test('but only once per ride', () => {
  assert.equal(shouldAutoOpen(meetup(), LANDING_MS + MINUTE, true), false);
});

test('not before landing, not once the group has found each other, not after the ride started', () => {
  assert.equal(shouldAutoOpen(meetup(), DAY_BEFORE, false), false);
  assert.equal(shouldAutoOpen(meetup({ meetupCompletedAt: '2026-10-13T15:10:00Z' }), LANDING_MS + 15 * MINUTE, false), false);
  assert.equal(shouldAutoOpen(meetup({ rideStartedAt: '2026-10-13T15:20:00Z' }), LANDING_MS + 30 * MINUTE, false), false);
  assert.equal(shouldAutoOpen(null, LANDING_MS, false), false);
});
