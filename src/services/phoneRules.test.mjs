// Run with: node --experimental-strip-types --test src/services/phoneRules.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { flagFor, phoneCountries, toE164 } from './phoneRules.ts';

test('a valid number becomes international, in each common format', () => {
  assert.equal(toE164('ES', '612 34 56 78'), '+34612345678');
  assert.equal(toE164('FR', '06 12 34 56 78'), '+33612345678');
  assert.equal(toE164('GB', '07400 123456'), '+447400123456');
  // Typed with its own prefix: that one counts, whatever country is picked.
  assert.equal(toE164('ES', '+33 6 12 34 56 78'), '+33612345678');
});

test('an invalid number is refused', () => {
  for (const [country, typed] of [
    ['ES', '123'],
    ['ES', '612 34 56'],
    ['FR', '00 00 00 00 00'],
    ['ES', 'call me'],
    ['ES', ''],
  ]) {
    assert.equal(toE164(country, typed), null, `${country} ${typed}`);
  }
});

test('the picker starts with Spain, then the usual countries, each with its dial code and flag', () => {
  const countries = phoneCountries();
  assert.deepEqual(countries[0], { code: 'ES', dialCode: '+34', flag: '🇪🇸' });
  assert.deepEqual(countries.slice(1, 3).map((c) => c.code), ['FR', 'GB']);
  assert.ok(countries.length > 200);
  assert.equal(new Set(countries.map((c) => c.code)).size, countries.length);
  assert.equal(flagFor('fr'), '🇫🇷');
});
