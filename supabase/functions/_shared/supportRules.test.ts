// Run with: node --experimental-strip-types --test supabase/functions/_shared/supportRules.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  callbackSlots,
  closeNeedsAlert,
  DEFAULT_SCHEDULE,
  isOfferedSlot,
  isOpen,
  isUrgent,
  localToUtc,
  makeReference,
  nextOpening,
  parseHandoverReason,
  parseSchedule,
  REFERENCE_ALPHABET,
  transcript,
  whatsappDigits,
  whatsappMessage,
} from './supportRules.ts';

const HOUR = 3_600_000;
// Barcelona wall-clock times, summer (UTC+2) and winter (UTC+1).
const summer = (day: number, hour: number, minute = 0) => localToUtc(2026, 7, day, hour, minute);
const winter = (day: number, hour: number, minute = 0) => localToUtc(2026, 12, day, hour, minute);

test('Barcelona time, summer and winter', () => {
  assert.equal(new Date(summer(15, 10)).toISOString(), '2026-07-15T08:00:00.000Z');
  assert.equal(new Date(winter(15, 10)).toISOString(), '2026-12-15T09:00:00.000Z');
});

const DAYTIME = parseSchedule(
  Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, { open: '08:00', close: '22:00' }]))
);

test('by default the team is there around the clock, also at midnight and across the clock change', () => {
  assert.deepEqual(DEFAULT_SCHEDULE.mon, { open: '00:00', close: '24:00' });
  for (const at of [summer(15, 0), summer(15, 23, 59), winter(15, 0), winter(15, 12), localToUtc(2026, 10, 25, 2, 30), localToUtc(2026, 3, 29, 3, 30)]) {
    assert.equal(isOpen(DEFAULT_SCHEDULE, at), true, new Date(at).toISOString());
  }
  // A night call back is on offer too: every half hour, round the clock.
  const slots = callbackSlots(DEFAULT_SCHEDULE, summer(15, 23));
  assert.equal(slots.find((s) => s.day === 'tomorrow')?.time, '00:00');
});

test('with set hours, the team is open 08:00-22:00 Barcelona time', () => {
  assert.equal(isOpen(DAYTIME, summer(15, 7, 59)), false);
  assert.equal(isOpen(DAYTIME, summer(15, 8)), true);
  assert.equal(isOpen(DAYTIME, winter(15, 21, 59)), true);
  assert.equal(isOpen(DAYTIME, winter(15, 22)), false);
});

test('outside hours: the next opening is the next morning', () => {
  assert.equal(nextOpening(DAYTIME, summer(15, 23)), summer(16, 8));
  assert.equal(nextOpening(DAYTIME, summer(15, 6)), summer(15, 8));
  assert.equal(nextOpening(DAYTIME, summer(15, 12)), summer(15, 12));
  // Closed on Sundays: Saturday night -> Monday morning (2026-07-18 is a Saturday).
  const noSunday = { ...DAYTIME, sun: null };
  assert.equal(nextOpening(noSunday, summer(18, 23)), summer(20, 8));
  assert.equal(nextOpening(parseSchedule({}), summer(18, 23)), null);
});

test('call-back slots: every half hour today and tomorrow, at least 30 minutes ahead, within hours', () => {
  const slots = callbackSlots(DAYTIME, summer(15, 21));
  assert.deepEqual(slots[0], { at: new Date(summer(15, 21, 30)).toISOString(), day: 'today', time: '21:30' });
  assert.equal(slots.filter((s) => s.day === 'today').length, 1, 'only 21:30 is left today');
  const tomorrow = slots.filter((s) => s.day === 'tomorrow');
  assert.equal(tomorrow[0].time, '08:00');
  assert.equal(tomorrow.at(-1)?.time, '21:30');
  assert.equal(tomorrow.length, 28);
  assert.equal(isOfferedSlot(slots[0].at, DAYTIME, summer(15, 21)), true);
  assert.equal(isOfferedSlot(new Date(summer(15, 23)).toISOString(), DAYTIME, summer(15, 21)), false);
});

test('a broken schedule setting closes that day instead of guessing', () => {
  const schedule = parseSchedule({
    mon: { open: '09:00', close: '17:00' },
    tue: { open: '18:00', close: '09:00' },
    wed: 'x',
    thu: { open: '00:00', close: '24:00' },
    fri: { open: '25:00', close: '26:00' },
  });
  assert.deepEqual(schedule.mon, { open: '09:00', close: '17:00' });
  assert.equal(schedule.tue, null);
  assert.equal(schedule.wed, null);
  assert.deepEqual(schedule.thu, { open: '00:00', close: '24:00' });
  assert.equal(schedule.fri, null);
});

test('references: 4 characters, none that can be misread', () => {
  let i = 0;
  const reference = makeReference(() => i++ % REFERENCE_ALPHABET.length);
  assert.equal(reference, 'ABCD');
  assert.doesNotMatch(REFERENCE_ALPHABET, /[0O1IL]/);
});

test('urgent: about to meet the group, on the way, or finished today', () => {
  const now = summer(15, 12);
  const base = { groupStatus: 'confirmed', meetingMs: null, rideStartedMs: null, groupCompletedMs: null, rideCompletedMs: null };
  assert.equal(isUrgent({ ...base, meetingMs: now + 2 * HOUR }, now), true, 'meeting in 2 hours');
  assert.equal(isUrgent({ ...base, meetingMs: now - HOUR }, now), true, 'meeting time passed');
  assert.equal(isUrgent({ ...base, meetingMs: now + 5 * HOUR }, now), false, 'meeting in 5 hours');
  assert.equal(isUrgent({ ...base, rideStartedMs: now - HOUR }, now), true, 'on the way');
  assert.equal(isUrgent({ ...base, groupStatus: 'unconfirmed', meetingMs: now + HOUR }, now), false, 'still an offer');
  assert.equal(isUrgent({ ...base, rideCompletedMs: summer(15, 9) }, now), true, 'completed this morning');
  assert.equal(isUrgent({ ...base, rideCompletedMs: summer(14, 22) }, now), false, 'completed yesterday');
  assert.equal(isUrgent({ ...base, groupStatus: null }, now), false, 'no group');
});

test('WhatsApp: only the ticket reference, in the chosen language', () => {
  assert.equal(whatsappMessage('en', 'A7K2'), 'Hi FLOQQ, I need help. Ticket #A7K2');
  assert.equal(whatsappMessage('fr', 'A7K2'), 'Bonjour FLOQQ, j’ai besoin d’aide. Ticket #A7K2');
  assert.equal(whatsappMessage('es', 'A7K2'), 'Hola FLOQQ, necesito ayuda. Ticket #A7K2');
  assert.equal(whatsappMessage('it', 'A7K2'), 'Ciao FLOQQ, ho bisogno di aiuto. Ticket #A7K2');
  assert.equal(whatsappMessage('nl', 'A7K2'), 'Hallo FLOQQ, ik heb hulp nodig. Ticket #A7K2');
  assert.equal(whatsappMessage('de', 'A7K2'), 'Hi FLOQQ, I need help. Ticket #A7K2');
  assert.equal(whatsappDigits('+34 612 34 56 78'), '34612345678');
  assert.equal(whatsappDigits('0034 612345678'), '34612345678');
  assert.equal(whatsappDigits(''), null);
  assert.equal(whatsappDigits(null), null);
});

test('unknown handover reasons become "other"; the transcript names who said what', () => {
  assert.equal(parseHandoverReason('money_problem'), 'money_problem');
  assert.equal(parseHandoverReason('drop table'), 'other');
  assert.equal(transcript([{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }]), 'Passenger: Hi\n\nAssistant: Hello');
});

test('closing a request alerts the team only for a call back planned within 2 hours (or as soon as possible)', () => {
  const now = Date.parse('2026-10-28T10:00:00Z');
  const at = (hours) => new Date(now + hours * 60 * 60_000).toISOString();
  assert.equal(closeNeedsAlert({ channel: 'callback', callbackAt: at(1) }, now), true);
  assert.equal(closeNeedsAlert({ channel: 'callback', callbackAt: null }, now), true);
  assert.equal(closeNeedsAlert({ channel: 'callback', callbackAt: at(3) }, now), false);
  assert.equal(closeNeedsAlert({ channel: 'whatsapp', callbackAt: null }, now), false);
});
