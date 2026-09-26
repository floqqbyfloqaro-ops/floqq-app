// Run with: node --experimental-strip-types --test supabase/functions/_shared/holdMath.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estimatedSharesCents, holdAmountCents, holdCovers, holdWindow, PLATFORM_FEE_CENTS, rideDepartureMs } from './holdMath.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

test('platform fee is 249 cents', () => {
  assert.equal(PLATFORM_FEE_CENTS, 249);
});

test('hold = share + fee + minimum EUR 5 buffer for small shares', () => {
  assert.equal(holdAmountCents(1000), 1000 + 249 + 500);
});

test('hold = share + fee + 25% buffer for larger shares', () => {
  assert.equal(holdAmountCents(4000), 4000 + 249 + 1000);
});

test('shares are integer cents and add up to the total fare', () => {
  const shares = estimatedSharesCents(
    [
      { id: 'a', distanceKm: 10 },
      { id: 'b', distanceKm: 20 },
      { id: 'c', distanceKm: 7 },
    ],
    38.6
  );
  const total = [...shares.values()].reduce((sum, c) => sum + c, 0);
  assert.equal(total, 3860);
  for (const cents of shares.values()) assert.ok(Number.isInteger(cents));
  assert.ok(shares.get('b')! > shares.get('a')!);
});

test('ride departure is the latest arrival plus the curb buffer', () => {
  const ride = rideDepartureMs(['2026-10-01T10:00:00Z', '2026-10-01T10:20:00Z']);
  assert.equal(ride, new Date('2026-10-01T10:30:00Z').getTime());
});

test('window opens now with a 60 min deadline for a ride tomorrow', () => {
  const now = Date.parse('2026-10-01T08:00:00Z');
  const { opensAt, deadlineAt } = holdWindow(now + DAY, now);
  assert.equal(opensAt.getTime(), now);
  assert.equal(deadlineAt.getTime(), now + 60 * MINUTE);
});

test('window waits until 5 days before a ride 8 days away', () => {
  const now = Date.parse('2026-10-01T08:00:00Z');
  const ride = now + 8 * DAY;
  const { opensAt, deadlineAt } = holdWindow(ride, now);
  assert.equal(opensAt.getTime(), ride - 5 * DAY);
  assert.equal(deadlineAt.getTime(), ride - 5 * DAY + 60 * MINUTE);
});

test('deadline is 30 min before a ride that is 70 min away', () => {
  const now = Date.parse('2026-10-01T08:00:00Z');
  const { deadlineAt } = holdWindow(now + 70 * MINUTE, now);
  assert.equal(deadlineAt.getTime(), now + 40 * MINUTE);
});

test('window is never shorter than 15 min, even right before the ride', () => {
  const now = Date.parse('2026-10-01T08:00:00Z');
  const { deadlineAt } = holdWindow(now + 20 * MINUTE, now);
  assert.equal(deadlineAt.getTime(), now + 15 * MINUTE);
});

test('a placed hold covers a share only if share + fee fits', () => {
  assert.equal(holdCovers(1749, 1000), true);
  assert.equal(holdCovers(1749, 1500), true);
  assert.equal(holdCovers(1749, 1501), false);
});
