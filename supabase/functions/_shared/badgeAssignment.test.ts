// Run with: node --experimental-strip-types --test supabase/functions/_shared/badgeAssignment.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BADGE_COLORS, BADGE_NUMBER_MAX, BADGE_NUMBER_MIN, pickBadge } from './badgeAssignment.ts';
import type { BadgeColor, ExistingBadge } from './badgeAssignment.ts';

const WINDOW_MINUTES = 60;
const MINUTE = 60_000;
const NOON = Date.parse('2026-10-10T12:00:00Z');

// A repeatable stand-in for Math.random.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const other = (color: BadgeColor, number: number, meetingPointId: string | null, minutesFromNoon = 0): ExistingBadge => ({
  color,
  number,
  meetingPointId,
  meetingTimeMs: NOON + minutesFromNoon * MINUTE,
});

test('a badge is one of the six colours with a two-digit number', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const badge = pickBadge([], 'T1-A', NOON, WINDOW_MINUTES, seeded(seed))!;
    assert.ok((BADGE_COLORS as readonly string[]).includes(badge.color));
    assert.ok(Number.isInteger(badge.number) && badge.number >= BADGE_NUMBER_MIN && badge.number <= BADGE_NUMBER_MAX);
  }
});

test('groups at the same meeting point get different colours while colours last', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const random = seeded(seed);
    const assigned: ExistingBadge[] = [];
    for (let i = 0; i < BADGE_COLORS.length; i++) {
      const badge = pickBadge(assigned, 'T1-A', NOON + i * MINUTE, WINDOW_MINUTES, random)!;
      assigned.push({ ...badge, meetingPointId: 'T1-A', meetingTimeMs: NOON + i * MINUTE });
    }
    assert.equal(new Set(assigned.map((b) => b.color)).size, BADGE_COLORS.length);
  }
});

test('a colour used at another meeting point is avoided too, but one at the same point first', () => {
  // Five colours are in use elsewhere in the terminal, blue is free: blue it is.
  const elsewhere = (['purple', 'teal', 'orange', 'pink', 'yellow'] as const).map((color, i) => other(color, 20 + i, 'T1-B'));
  assert.equal(pickBadge(elsewhere, 'T1-A', NOON, WINDOW_MINUTES, seeded(3))?.color, 'blue');

  // Every colour is in use somewhere; only purple is in use at this group's own point. Anything
  // but purple.
  const everywhere = [...elsewhere, other('blue', 30, 'T1-B'), other('purple', 31, 'T1-A')];
  for (let seed = 1; seed <= 20; seed++) {
    assert.notEqual(pickBadge(everywhere, 'T1-A', NOON, WINDOW_MINUTES, seeded(seed))?.color, 'purple');
  }
});

test('colour and number together are never repeated within the window', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const random = seeded(seed);
    const assigned: ExistingBadge[] = [];
    for (let i = 0; i < 120; i++) {
      const badge = pickBadge(assigned, i % 2 ? 'T1-A' : 'T1-B', NOON, WINDOW_MINUTES, random)!;
      assigned.push({ ...badge, meetingPointId: i % 2 ? 'T1-A' : 'T1-B', meetingTimeMs: NOON });
    }
    assert.equal(new Set(assigned.map((b) => `${b.color}-${b.number}`)).size, assigned.length);
  }
});

test('a colour whose numbers are all taken is skipped', () => {
  const allPurple = Array.from({ length: 90 }, (_, i) => other('purple', 10 + i, 'T1-B'));
  const blockers = (['teal', 'orange', 'pink', 'yellow', 'blue'] as const).map((color) => other(color, 10, 'T1-A'));
  // Purple is the only colour free at T1-A, but it has no number left.
  const badge = pickBadge([...allPurple, ...blockers], 'T1-A', NOON, WINDOW_MINUTES, seeded(7))!;
  assert.notEqual(badge.color, 'purple');
  assert.ok(!(badge.number === 10 && blockers.some((b) => b.color === badge.color)));
});

test('a badge is free again for a group meeting outside the window', () => {
  const allColoursAtNoon = BADGE_COLORS.flatMap((color) =>
    Array.from({ length: 90 }, (_, i) => other(color, 10 + i, 'T1-A'))
  );
  assert.equal(pickBadge(allColoursAtNoon, 'T1-A', NOON, WINDOW_MINUTES, seeded(1)), null);
  assert.equal(pickBadge(allColoursAtNoon, 'T1-A', NOON + 60 * MINUTE, WINDOW_MINUTES, seeded(1)), null);
  assert.notEqual(pickBadge(allColoursAtNoon, 'T1-A', NOON + 61 * MINUTE, WINDOW_MINUTES, seeded(1)), null);
});

test('a group without a meeting point still gets a badge, unique in its terminal', () => {
  const others = [other('purple', 42, null), other('teal', 42, 'T1-A')];
  for (let seed = 1; seed <= 20; seed++) {
    const badge = pickBadge(others, null, NOON, WINDOW_MINUTES, seeded(seed))!;
    assert.ok(!others.some((o) => o.color === badge.color && o.number === badge.number));
  }
});
