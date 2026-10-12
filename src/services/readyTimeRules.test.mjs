// Run with: node --experimental-strip-types --test src/services/readyTimeRules.test.mjs
//
// A plain .mjs file on purpose: the app's own TypeScript check doesn't cover test files, and Node
// loads the .ts file under test directly. The matching rule itself is tested in full on the
// server's copy (supabase/functions/_shared/readyTimeRule.test.ts); this checks that the app's
// copy agrees, and what only the app has.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { calibrationVerdict, flightTimeChange, meetingTimeMs, readyIso, waitMinutes, waitsFit } from './readyTimeRules.ts';

const at = (time) => `2026-10-13T${time}:00Z`;
const boston = (maxWait = 15) => ({ id: 'boston', arrival_at: at('14:00'), ready_at: at('15:00'), max_wait_minutes: maxWait });
const madrid = (maxWait = 15) => ({ id: 'madrid', arrival_at: at('14:00'), ready_at: at('14:25'), max_wait_minutes: maxWait });

test('the group meets when its last member is ready', () => {
  assert.equal(meetingTimeMs([boston(), madrid()]), Date.parse(at('15:00')));
  assert.equal(waitMinutes(madrid(), Date.parse(at('15:00'))), 35);
});

test('Boston and Madrid match only when the Madrid passenger’s own maximum wait covers the gap', () => {
  assert.equal(waitsFit([boston(), madrid(15)]), false);
  assert.equal(waitsFit([boston(), madrid(35)]), true);
  assert.equal(waitsFit([boston(120), madrid(15)]), false);
});

test('a ride read without its ready time goes by its arrival', () => {
  assert.equal(readyIso({ arrival_at: at('14:00'), ready_at: null }), at('14:00'));
});

test('a confirmed group’s member is flagged when their flight has moved 10 minutes or more', () => {
  const ride = (estimated) => ({ arrival_at: at('14:00'), flight_estimated_arrival_at: estimated });
  assert.equal(flightTimeChange(ride(null), 10), null);
  assert.equal(flightTimeChange(ride(at('14:09')), 10), null);
  assert.deepEqual(flightTimeChange(ride(at('14:25')), 10), { minutes: 25, estimatedAt: at('14:25') });
  assert.deepEqual(flightTimeChange(ride(at('13:45')), 10), { minutes: -15, estimatedAt: at('13:45') });
});

test('calibration: later than calculated, earlier, or as calculated', () => {
  assert.equal(calibrationVerdict(8), 'later');
  assert.equal(calibrationVerdict(-6.5), 'earlier');
  assert.equal(calibrationVerdict(0.4), 'onTime');
  assert.equal(calibrationVerdict(-0.9), 'onTime');
});

// The texts passengers see about the meeting time, in every language.
const locale = (code) => JSON.parse(readFileSync(new URL(`../i18n/locales/${code}.json`, import.meta.url), 'utf8'));
const fill = (text, values) => text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name]));

test('the meeting time explainer, in English, French and Spanish', () => {
  assert.equal(locale('en').meeting_time_explainer, 'Includes time to leave the plane, passport control and luggage.');
  assert.equal(
    locale('fr').meeting_time_explainer,
    "Comprend le temps de quitter l'avion, le contrôle des passeports et les bagages."
  );
  assert.equal(
    locale('es').meeting_time_explainer,
    'Incluye el tiempo para salir del avión, el control de pasaportes y el equipaje.'
  );
});

test('"Ready around 14:50" and the meeting time, in every language', () => {
  assert.equal(fill(locale('en').ready_around, { time: '14:50' }), 'Ready around 14:50');
  for (const code of ['en', 'fr', 'es']) {
    assert.match(fill(locale(code).ready_around, { time: '14:50' }), /14:50/);
    assert.match(fill(locale(code).meeting_time_label, { time: '15:00' }), /15:00/);
  }
});

test('every kind of ride in the calibration has a name in every language', () => {
  for (const code of ['en', 'fr', 'es']) {
    const names = locale(code).adminCalibration.category;
    for (const category of ['schengen', 'non_schengen', 'unknown', 'no_flight']) {
      assert.equal(typeof names[category].bag, 'string');
      assert.equal(typeof names[category].noBag, 'string');
    }
  }
});
