// Run with: node --experimental-strip-types --test src/services/profileRules.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  barcelonaToday,
  cleanPersonName,
  isAdultOn,
  isPlausibleEmail,
  isValidPersonName,
  parseIsoDate,
  toIsoDate,
} from './profileRules.ts';

test('names with accents, hyphens, apostrophes and spaces are accepted', () => {
  for (const name of ['José', 'Anne-Marie', "O'Neil", 'O’Neil', "'t Hooft", 'María José', 'Łukasz', 'Zoë', 'Ζωή', 'Ana']) {
    assert.equal(isValidPersonName(name), true, name);
  }
});

test('invalid names are rejected', () => {
  for (const name of ['', '   ', 'J0sé', 'Anne_Marie', 'Bob!', 'test@x', '---', "''", 'a'.repeat(51), 'Ann 😀']) {
    assert.equal(isValidPersonName(name), false, JSON.stringify(name));
  }
  assert.equal(isValidPersonName('a'.repeat(50)), true);
});

test('names are tidied before they are checked or saved', () => {
  assert.equal(cleanPersonName('  Anne   Marie  '), 'Anne Marie');
  // A decomposed é (e + combining accent) becomes the single character.
  assert.equal(cleanPersonName('José'), 'José');
  assert.equal(isValidPersonName('José'), true);
});

const day = (iso) => parseIsoDate(iso);

test('exactly 18 today is accepted; 17 years and 364 days is not', () => {
  const today = day('2026-10-22');
  assert.equal(isAdultOn(day('2008-10-22'), today), true);
  assert.equal(isAdultOn(day('2008-10-23'), today), false);
  assert.equal(isAdultOn(day('1980-01-01'), today), true);
});

test('a 29 February birthday turns 18 on 1 March in a non-leap year', () => {
  assert.equal(isAdultOn(day('2008-02-29'), day('2026-02-28')), false);
  assert.equal(isAdultOn(day('2008-02-29'), day('2026-03-01')), true);
});

test('dates are read and written as YYYY-MM-DD, and impossible dates are refused', () => {
  assert.deepEqual(parseIsoDate('2008-10-22'), { year: 2008, month: 10, day: 22 });
  assert.equal(toIsoDate({ year: 2008, month: 3, day: 7 }), '2008-03-07');
  assert.equal(parseIsoDate('2026-02-29'), null);
  assert.equal(parseIsoDate('22/10/2008'), null);
});

test('today is counted in Barcelona: just after midnight there it is already the next day', () => {
  // 23:30 UTC on 21 October is 01:30 on 22 October in Barcelona (summer time).
  assert.deepEqual(barcelonaToday(new Date('2026-10-21T23:30:00Z')), { year: 2026, month: 10, day: 22 });
});

test('email format is checked before anything is sent', () => {
  assert.equal(isPlausibleEmail('anna@example.com'), true);
  assert.equal(isPlausibleEmail(' anna@example.com '), true);
  for (const email of ['', 'anna', 'anna@', 'anna@example', 'an na@example.com', '@example.com']) {
    assert.equal(isPlausibleEmail(email), false, email);
  }
});
