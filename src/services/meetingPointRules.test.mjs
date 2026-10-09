// Run with: node --experimental-strip-types --test src/services/meetingPointRules.test.mjs
//
// A plain .mjs file on purpose: the app's own TypeScript check doesn't cover test files, and Node
// loads the .ts file under test directly.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hasAllWording,
  meetingPointText,
  missingForActivation,
  missingForVerification,
  wordingLanguageFor,
} from './meetingPointRules.ts';

// The wording shipped with the app: every key exists in every language unless a test says otherwise.
const shippedEverywhere = (key, language) => `${key} (${language})`;
const shippedExceptFrench = (key, language) => (language === 'fr' ? null : `${key} (${language})`);
const shippedNowhere = () => null;

const point = (overrides = {}) => ({
  id: 'p1',
  airport_code: 'BCN',
  terminal: 'T1',
  short_code: 'T1-A',
  name_key: 'meetingPoints.T1-A.name',
  directions_key: 'meetingPoints.T1-A.directions',
  name_i18n: null,
  directions_i18n: null,
  latitude: null,
  longitude: null,
  photo_path: null,
  is_active: false,
  sort_priority: 50,
  verified_at: null,
  verified_by: null,
  ...overrides,
});

const complete = { latitude: 41.29, longitude: 2.07, photo_path: 'T1-A/1.jpg' };
const verified = { ...complete, verified_at: '2026-10-10T10:00:00Z', verified_by: 'admin' };

test('a fresh candidate is missing coordinates, a photo and verification', () => {
  assert.deepEqual(missingForActivation(point(), shippedEverywhere), ['coordinates', 'photo', 'verified']);
});

test('a point with everything can be activated', () => {
  assert.deepEqual(missingForActivation(point(verified), shippedEverywhere), []);
});

test('coordinates, photo and wording are not enough: it must be verified on site', () => {
  assert.deepEqual(missingForVerification(point(complete), shippedEverywhere), []);
  assert.deepEqual(missingForActivation(point(complete), shippedEverywhere), ['verified']);
});

test('one coordinate without the other counts as no coordinates', () => {
  assert.deepEqual(missingForVerification(point({ ...complete, longitude: null }), shippedEverywhere), ['coordinates']);
});

test('wording missing in one language blocks verification and activation', () => {
  assert.deepEqual(missingForVerification(point(complete), shippedExceptFrench), ['wording']);
  assert.deepEqual(missingForActivation(point(verified), shippedExceptFrench), ['wording']);
});

test("the admin's wording fills a language the app doesn't ship", () => {
  const filled = point({
    ...verified,
    name_i18n: { fr: 'Office de tourisme' },
    directions_i18n: { fr: 'Niveau 0.' },
  });
  assert.equal(hasAllWording(filled, shippedExceptFrench), true);
  assert.deepEqual(missingForActivation(filled, shippedExceptFrench), []);
});

test('both the name and the directions are needed, in every language', () => {
  const nameOnly = point({ ...verified, name_i18n: { en: 'A', fr: 'B', es: 'C' } });
  assert.equal(hasAllWording(nameOnly, shippedNowhere), false);
});

test("the admin's wording wins over the shipped wording, per language", () => {
  const edited = point({ name_i18n: { es: '  Oficina de turismo  ' } });
  assert.equal(meetingPointText(edited, 'name', 'es', shippedEverywhere), 'Oficina de turismo');
  assert.equal(meetingPointText(edited, 'name', 'en', shippedEverywhere), 'meetingPoints.T1-A.name (en)');
  assert.equal(meetingPointText(edited, 'directions', 'es', shippedEverywhere), 'meetingPoints.T1-A.directions (es)');
});

test('an empty edit falls back to the shipped wording', () => {
  const blanked = point({ name_i18n: { en: '   ' } });
  assert.equal(meetingPointText(blanked, 'name', 'en', shippedEverywhere), 'meetingPoints.T1-A.name (en)');
  assert.equal(meetingPointText(blanked, 'name', 'en', shippedNowhere), '');
});

test('points are read in the app language when it is supported, otherwise in English', () => {
  assert.equal(wordingLanguageFor('fr'), 'fr');
  assert.equal(wordingLanguageFor('es-ES'), 'es');
  assert.equal(wordingLanguageFor('en-GB'), 'en');
  assert.equal(wordingLanguageFor('nl'), 'en');
  assert.equal(wordingLanguageFor('de-DE'), 'en');
});
