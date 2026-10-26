// Run with: node --experimental-strip-types --test supabase/functions/_shared/helpActions.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACTION_TEXTS, cancelConsequence, cancelDoneText, canReopen } from './helpActions.ts';

const NOW = Date.parse('2026-10-27T10:00:00Z');
const HOUR = 60 * 60_000;
const hold = (freeCancelUntil, status = 'HOLD_PLACED') => ({ status, holdCents: 2749, feeCents: 249, freeCancelUntil });

test('still searching: nothing to pay', () => {
  assert.deepEqual(cancelConsequence({ groupId: null, payment: null }, NOW), { kind: 'searching' });
});

test('a seat reserved more than 24 hours before the ride: free, the whole hold released', () => {
  const until = new Date(NOW + HOUR).toISOString();
  assert.deepEqual(cancelConsequence({ groupId: 'g', payment: hold(until) }, NOW), { kind: 'free', releasedCents: 2749 });
});

test('within 24 hours: the FLOQQ fee is kept, the rest released', () => {
  const until = new Date(NOW - HOUR).toISOString();
  assert.deepEqual(cancelConsequence({ groupId: 'g', payment: hold(until) }, NOW), { kind: 'fee_kept', feeCents: 249, releasedCents: 2500 });
});

test('a group but nothing reserved (or not reserved any more): nothing charged', () => {
  assert.deepEqual(cancelConsequence({ groupId: 'g', payment: null }, NOW), { kind: 'no_charge' });
  assert.deepEqual(cancelConsequence({ groupId: 'g', payment: hold(null, 'NOT_STARTED') }, NOW), { kind: 'no_charge' });
  assert.deepEqual(cancelConsequence({ groupId: 'g', payment: hold(null, 'HOLD_FAILED') }, NOW), { kind: 'no_charge' });
});

test('"Done" says what happened to the money, in each language, in its own euro format', () => {
  assert.equal(cancelDoneText({ kind: 'fee_kept', feeCents: 249, releasedCents: 2500 }, 'en'), 'Done - your ride is cancelled. The €2.49 FLOQQ fee is kept and the remaining €25.00 is released from your card.');
  assert.match(cancelDoneText({ kind: 'free', releasedCents: 2749 }, 'fr'), /27,49 €/);
  assert.match(cancelDoneText({ kind: 'searching' }, 'es'), /^Hecho: tu trayecto está cancelado\./);
  for (const language of ['en', 'fr', 'es']) {
    for (const key of Object.keys(ACTION_TEXTS.en)) assert.equal(typeof ACTION_TEXTS[language][key], 'string', `${language} ${key}`);
  }
});

test('a resolved conversation reopens within 10 minutes of its closing, not after, and nothing else reopens', () => {
  const closed = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();
  assert.equal(canReopen('resolved_by_assistant', closed(2), NOW), true);
  assert.equal(canReopen('resolved_by_assistant', closed(11), NOW), false);
  assert.equal(canReopen('resolved_by_team', closed(2), NOW), false);
  assert.equal(canReopen('closed_no_reply', closed(2), NOW), false);
  assert.equal(canReopen('resolved_by_assistant', null, NOW), false);
});
