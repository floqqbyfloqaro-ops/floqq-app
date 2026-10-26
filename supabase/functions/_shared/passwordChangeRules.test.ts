// Run with: node --experimental-strip-types --test supabase/functions/_shared/passwordChangeRules.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  attemptsLeft,
  emailLanguageFor,
  EMAIL_LANGUAGES,
  lockedUntil,
  newPasswordProblem,
  passwordChangedEmail,
  SUPPORT_EMAIL,
} from './passwordChangeRules.ts';

const MINUTE = 60_000;
const NOW = Date.parse('2026-10-26T12:00:00Z');

test('the new password: at least 8 characters, at most 72, and not the current one', () => {
  assert.equal(newPasswordProblem('old-password', 'short7!'), 'too_short');
  assert.equal(newPasswordProblem('old-password', 'x'.repeat(73)), 'too_long');
  assert.equal(newPasswordProblem('same-password', 'same-password'), 'same_as_current');
  assert.equal(newPasswordProblem('old-password', 'eight888'), null);
  assert.equal(newPasswordProblem('old-password', 'x'.repeat(72)), null);
});

test('4 wrong tries in 15 minutes: still allowed; the 5th locks for 15 minutes from then', () => {
  const four = [1, 2, 3, 4].map((m) => NOW - m * MINUTE);
  assert.equal(lockedUntil(four, NOW), null);
  const five = [...four, NOW];
  assert.equal(lockedUntil(five, NOW), NOW + 15 * MINUTE);
  assert.equal(lockedUntil(five, NOW + 14 * MINUTE), NOW + 15 * MINUTE);
  assert.equal(lockedUntil(five, NOW + 15 * MINUTE), null);
});

test('the wait lasts 15 minutes from the 5th try, even after the earlier tries are 15 minutes old', () => {
  const five = [10, 8, 6, 4, 2].map((m) => NOW - m * MINUTE);
  assert.equal(lockedUntil(five, NOW + 12 * MINUTE), NOW + 13 * MINUTE);
  assert.equal(lockedUntil(five, NOW + 13 * MINUTE), null);
});

test('5 wrong tries spread over more than 15 minutes never lock', () => {
  const spread = [20, 16, 12, 8, 4].map((m) => NOW - m * MINUTE);
  assert.equal(lockedUntil(spread, NOW), null);
});

test('tries left: only the wrong ones in the last 15 minutes count', () => {
  assert.equal(attemptsLeft([], NOW), 5);
  assert.equal(attemptsLeft([NOW - MINUTE, NOW - 20 * MINUTE], NOW), 4);
  assert.equal(attemptsLeft([1, 2, 3, 4, 5, 6].map((m) => NOW - m * MINUTE), NOW), 0);
});

test("the email follows the phone's language; any other language gets English", () => {
  assert.equal(emailLanguageFor('fr'), 'fr');
  assert.equal(emailLanguageFor('nl-BE'), 'nl');
  assert.equal(emailLanguageFor('IT'), 'it');
  assert.equal(emailLanguageFor('de'), 'en');
  assert.equal(emailLanguageFor(undefined), 'en');
});

test('every email: its own subject, the support address, and no password in it', () => {
  const subjects = new Set();
  for (const language of EMAIL_LANGUAGES) {
    const email = passwordChangedEmail(language);
    subjects.add(email.subject);
    assert.match(email.subject, /FLOQQ/, language);
    assert.ok(email.text.includes(SUPPORT_EMAIL), language);
    assert.doesNotMatch(email.text, /\{support\}/, language);
  }
  assert.equal(subjects.size, EMAIL_LANGUAGES.length);
  assert.match(passwordChangedEmail('fr').text, /Mot de passe oublié/);
  assert.match(passwordChangedEmail('nl').text, /Forgot password\?/);
});
