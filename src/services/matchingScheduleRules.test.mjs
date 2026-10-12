// Run with: node --experimental-strip-types --test src/services/matchingScheduleRules.test.mjs
//
// A plain .mjs file on purpose: the app's own TypeScript check doesn't cover test files, and Node
// loads the .ts file under test directly.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { formatCountdown, matchingCountdown, nextRunMs, previousRunMs } from './matchingScheduleRules.ts';

const at = (time) => Date.parse(`2026-10-12T${time}Z`);

test('with a 5-minute schedule the job runs at :00, :05, :10, ...', () => {
  assert.equal(previousRunMs(at('12:01:48'), 5), at('12:00:00'));
  assert.equal(nextRunMs(at('12:01:48'), 5), at('12:05:00'));
  assert.equal(nextRunMs(at('12:55:00'), 5), at('13:00:00'));
  assert.equal(nextRunMs(at('12:59:59'), 5), at('13:00:00'));
});

test('"Next check in 3:12"', () => {
  const countdown = matchingCountdown(at('12:01:48'), 5, at('12:00:04'));
  assert.deepEqual(countdown, { kind: 'countdown', secondsLeft: 192 });
  assert.equal(formatCountdown(192), '3:12');
});

test('the countdown is written as minutes and two-digit seconds', () => {
  assert.equal(formatCountdown(300), '5:00');
  assert.equal(formatCountdown(65), '1:05');
  assert.equal(formatCountdown(9), '0:09');
  assert.equal(formatCountdown(0), '0:00');
});

test('at zero it is "Checking now..." until the run has finished', () => {
  // The last finished run is the previous one.
  assert.deepEqual(matchingCountdown(at('12:05:00'), 5, at('12:00:04')), { kind: 'checking' });
  assert.deepEqual(matchingCountdown(at('12:05:03'), 5, at('12:00:04')), { kind: 'checking' });
});

test('once the run has finished the countdown restarts', () => {
  assert.deepEqual(matchingCountdown(at('12:05:06'), 5, at('12:05:05')), { kind: 'countdown', secondsLeft: 294 });
});

test('a run that never reports back does not leave the screen stuck', () => {
  assert.deepEqual(matchingCountdown(at('12:05:29'), 5, at('12:00:04')), { kind: 'checking' });
  assert.deepEqual(matchingCountdown(at('12:05:30'), 5, at('12:00:04')), { kind: 'countdown', secondsLeft: 270 });
});

test('when nothing is known about the last run, it still counts down', () => {
  assert.deepEqual(matchingCountdown(at('12:02:00'), 5, null), { kind: 'countdown', secondsLeft: 180 });
});

test('another interval works the same way', () => {
  assert.equal(nextRunMs(at('12:00:20'), 1), at('12:01:00'));
  assert.deepEqual(matchingCountdown(at('12:00:40'), 1, at('12:00:02')), { kind: 'countdown', secondsLeft: 20 });
  // An interval that doesn't divide the hour starts again at the full hour, as the schedule does.
  assert.equal(nextRunMs(at('12:57:00'), 7), at('13:00:00'));
});

// The texts of the "Finding your match" screen, in every language, with the number filled in.
const locale = (code) => JSON.parse(readFileSync(new URL(`../i18n/locales/${code}.json`, import.meta.url), 'utf8'));
const fill = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name]));

test('English texts', () => {
  const en = locale('en');
  assert.equal(
    fill(en.matching_interval_explainer, { minutes: 5 }),
    'We check for matches every 5 minutes to group you with the most compatible travelers and get you the lowest fare.'
  );
  assert.equal(fill(en.matching_next_check, { time: '3:12' }), 'Next check in 3:12');
  assert.equal(en.matching_checking_now, 'Checking now...');
});

test('French texts', () => {
  const fr = locale('fr');
  assert.equal(
    fill(fr.matching_interval_explainer, { minutes: 5 }),
    'Nous recherchons des correspondances toutes les 5 minutes pour vous associer aux voyageurs les plus compatibles et vous offrir le meilleur prix.'
  );
  assert.equal(fill(fr.matching_next_check, { time: '3:12' }), 'Prochaine recherche dans 3:12');
  assert.equal(fr.matching_checking_now, 'Recherche en cours...');
});

test('Spanish texts', () => {
  const es = locale('es');
  assert.equal(
    fill(es.matching_interval_explainer, { minutes: 5 }),
    'Buscamos coincidencias cada 5 minutos para agruparte con los viajeros más compatibles y conseguirte la tarifa más baja.'
  );
  assert.equal(fill(es.matching_next_check, { time: '3:12' }), 'Próxima búsqueda en 3:12');
  assert.equal(es.matching_checking_now, 'Buscando ahora...');
});

test('the number is never written into the text itself', () => {
  for (const code of ['en', 'fr', 'es']) {
    assert.match(locale(code).matching_interval_explainer, /\{\{minutes\}\}/);
    assert.doesNotMatch(locale(code).matching_interval_explainer, /\d/);
  }
});
