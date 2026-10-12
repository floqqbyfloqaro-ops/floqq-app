// Run with: node --experimental-strip-types --test supabase/functions/_shared/readyTimeRule.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { meetingTimeMs, readyIso, waitMinutes, waitOverLimit, waitsFit } from './readyTimeRule.ts';

const at = (time: string) => `2026-10-13T${time}:00Z`;
const ms = (time: string) => Date.parse(at(time));

// Both at the gate at 14:00. Boston: non-Schengen with a checked bag, ready 60 minutes later.
// Madrid: Schengen with hand luggage, ready 25 minutes later.
const boston = (maxWait = 15) => ({ id: 'boston', arrival_at: at('14:00'), ready_at: at('15:00'), max_wait_minutes: maxWait });
const madrid = (maxWait = 15) => ({ id: 'madrid', arrival_at: at('14:00'), ready_at: at('14:25'), max_wait_minutes: maxWait });

test('the group meets when its last member is ready, not when the last plane arrives', () => {
  assert.equal(meetingTimeMs([boston(), madrid()]), ms('15:00'));
});

test('each member waits from their own ready time', () => {
  const meeting = meetingTimeMs([boston(), madrid()]);
  assert.equal(waitMinutes(madrid(), meeting), 35);
  assert.equal(waitMinutes(boston(), meeting), 0);
});

test('Boston and Madrid do not match when the Madrid passenger will only wait 15 minutes', () => {
  assert.equal(waitsFit([boston(), madrid(15)]), false);
  assert.deepEqual(waitOverLimit([boston(), madrid(15)]), { request_id: 'madrid', waiting_minutes: 35, max_wait_minutes: 15 });
});

test('they match when the Madrid passenger’s maximum wait covers the 35-minute gap', () => {
  assert.equal(waitsFit([boston(), madrid(34)]), false);
  assert.equal(waitsFit([boston(), madrid(35)]), true);
  assert.equal(waitsFit([boston(), madrid(45)]), true);
});

test('it is the waiting passenger’s own maximum that counts, not the other’s', () => {
  // Boston waits for nobody, so their short maximum wait doesn't matter.
  assert.equal(waitsFit([boston(5), madrid(40)]), true);
  // And a patient Boston passenger doesn't make up for an impatient Madrid one.
  assert.equal(waitsFit([boston(120), madrid(15)]), false);
});

test('never the average: one member over their maximum is enough to refuse a group of three', () => {
  const lisbon = { id: 'lisbon', arrival_at: at('14:20'), ready_at: at('14:45'), max_wait_minutes: 60 };
  // Waits are 0, 35 and 15 minutes - 17 on average, under everyone's maximum - but Madrid's own
  // wait is over Madrid's own 30.
  assert.equal(waitsFit([boston(60), madrid(30), lisbon]), false);
  assert.equal(waitsFit([boston(60), madrid(35), lisbon]), true);
});

test('in a group of three every pair may fit while the group does not', () => {
  const early = { id: 'early', arrival_at: at('13:30'), ready_at: at('13:55'), max_wait_minutes: 20 };
  const middle = { id: 'middle', arrival_at: at('13:50'), ready_at: at('14:15'), max_wait_minutes: 20 };
  const last = { id: 'last', arrival_at: at('14:05'), ready_at: at('14:30'), max_wait_minutes: 20 };
  assert.equal(waitsFit([early, middle]), true);
  assert.equal(waitsFit([middle, last]), true);
  // Together they meet at 14:30: 35 minutes after the first one is ready.
  assert.equal(waitsFit([early, middle, last]), false);
});

test('a ride read without its ready time goes by its arrival', () => {
  assert.equal(readyIso({ arrival_at: at('14:00') }), at('14:00'));
  assert.equal(readyIso({ arrival_at: at('14:00'), ready_at: null }), at('14:00'));
});

test('a delay that pushes one member’s ready time back can break a group that fitted', () => {
  const onTime = [boston(), madrid(40)];
  assert.equal(waitsFit(onTime), true);
  // Boston is delayed by 20 minutes: ready at 15:20, so Madrid would wait 55.
  const delayed = [{ ...boston(), arrival_at: at('14:20'), ready_at: at('15:20') }, madrid(40)];
  assert.equal(waitsFit(delayed), false);
});
