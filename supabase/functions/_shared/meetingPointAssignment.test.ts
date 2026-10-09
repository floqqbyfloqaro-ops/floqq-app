// Run with: node --experimental-strip-types --test supabase/functions/_shared/meetingPointAssignment.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { meetingTerminalFor, pickMeetingPoint } from './meetingPointAssignment.ts';
import type { AssignablePoint, ExistingAssignment } from './meetingPointAssignment.ts';

const WINDOW_MINUTES = 20;
const MINUTE = 60_000;
const NOON = Date.parse('2026-10-10T12:00:00Z');

const point = (shortCode: string, terminal: string, sortPriority: number, isActive = true): AssignablePoint => ({
  id: shortCode,
  terminal,
  shortCode,
  sortPriority,
  isActive,
});

const POINTS = [
  point('T1-A', 'T1', 50),
  point('T1-B', 'T1', 40),
  point('T1-C', 'T1', 30),
  point('T2-A', 'T2B', 40),
  point('T2-B', 'T2B', 30),
];

const at = (meetingPointId: string, minutesFromNoon: number): ExistingAssignment => ({
  meetingPointId,
  meetingTimeMs: NOON + minutesFromNoon * MINUTE,
});

test('a group gets the highest-priority point at its terminal', () => {
  const choice = pickMeetingPoint(POINTS, 'T1', NOON, [], WINDOW_MINUTES);
  assert.equal(choice?.point.shortCode, 'T1-A');
  assert.equal(choice?.overlapping, 0);
});

test('two overlapping groups at T1 get different points', () => {
  const first = pickMeetingPoint(POINTS, 'T1', NOON, [], WINDOW_MINUTES)!;
  const second = pickMeetingPoint(POINTS, 'T1', NOON + 10 * MINUTE, [at(first.point.id, 0)], WINDOW_MINUTES)!;
  assert.equal(first.point.shortCode, 'T1-A');
  assert.equal(second.point.shortCode, 'T1-B');
  assert.equal(second.overlapping, 0);
});

test('a point is free again for a group meeting outside the window', () => {
  const choice = pickMeetingPoint(POINTS, 'T1', NOON + 21 * MINUTE, [at('T1-A', 0)], WINDOW_MINUTES);
  assert.equal(choice?.point.shortCode, 'T1-A');
});

test('a group meeting exactly at the edge of the window still counts as overlapping', () => {
  const choice = pickMeetingPoint(POINTS, 'T1', NOON + 20 * MINUTE, [at('T1-A', 0)], WINDOW_MINUTES);
  assert.equal(choice?.point.shortCode, 'T1-B');
});

test('all points busy: the least busy one, then the highest priority', () => {
  const others = [at('T1-A', 0), at('T1-A', 5), at('T1-B', 0), at('T1-C', 0), at('T1-C', -5)];
  const choice = pickMeetingPoint(POINTS, 'T1', NOON, others, WINDOW_MINUTES);
  assert.equal(choice?.point.shortCode, 'T1-B');
  assert.equal(choice?.overlapping, 1);

  const tied = pickMeetingPoint(POINTS, 'T1', NOON, [at('T1-A', 0), at('T1-B', 0), at('T1-C', 0)], WINDOW_MINUTES);
  assert.equal(tied?.point.shortCode, 'T1-A');
  assert.equal(tied?.overlapping, 1);
});

test('an inactive point is never assigned, even when it has the highest priority', () => {
  const points = [point('T1-X', 'T1', 99, false), ...POINTS];
  assert.equal(pickMeetingPoint(points, 'T1', NOON, [], WINDOW_MINUTES)?.point.shortCode, 'T1-A');
});

test('T2 arrivals (T2, T2A, T2B, T2C) all meet at the T2B points', () => {
  for (const terminal of ['T2', 'T2A', 'T2B', 'T2C']) {
    assert.equal(meetingTerminalFor(terminal), 'T2B');
    assert.equal(pickMeetingPoint(POINTS, terminal, NOON, [], WINDOW_MINUTES)?.point.shortCode, 'T2-A');
  }
  assert.equal(meetingTerminalFor('T1'), 'T1');
});

test('a T1 group at the same time does not take a T2 point, and the other way round', () => {
  const choice = pickMeetingPoint(POINTS, 'T2', NOON, [at('T1-A', 0), at('T1-B', 0)], WINDOW_MINUTES);
  assert.equal(choice?.point.shortCode, 'T2-A');
});

test('no active point at the terminal: nothing is assigned', () => {
  const onlyT2 = POINTS.filter((p) => p.terminal === 'T2B');
  assert.equal(pickMeetingPoint(onlyT2, 'T1', NOON, [], WINDOW_MINUTES), null);
  assert.equal(pickMeetingPoint(POINTS, 'T3', NOON, [], WINDOW_MINUTES), null);
});
