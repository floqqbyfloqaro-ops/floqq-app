// Proves that a group's live-location channel ("Find your group") is closed to everyone but the
// group's own members. Runs against the real Supabase project with three real test accounts:
// two passengers in one CONFIRMED group, and one account that is not in it.
//
// Put these in .env.meetup-test.local (ignored by git), next to the app's own .env:
//   MEETUP_TEST_GROUP_ID=<id of the confirmed taxi group>
//   MEETUP_MEMBER_A_EMAIL=...     MEETUP_MEMBER_A_PASSWORD=...
//   MEETUP_MEMBER_B_EMAIL=...     MEETUP_MEMBER_B_PASSWORD=...
//   MEETUP_OUTSIDER_EMAIL=...     MEETUP_OUTSIDER_PASSWORD=...
//
// Run with:
//   node --env-file=.env --env-file=.env.meetup-test.local scripts/meetup-channel-security-test.mjs
//
// The position it sends is a made-up one (0, 0) and, like every position, is stored nowhere.

import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const groupId = process.env.MEETUP_TEST_GROUP_ID;

const required = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'MEETUP_TEST_GROUP_ID',
  'MEETUP_MEMBER_A_EMAIL',
  'MEETUP_MEMBER_A_PASSWORD',
  'MEETUP_MEMBER_B_EMAIL',
  'MEETUP_MEMBER_B_PASSWORD',
  'MEETUP_OUTSIDER_EMAIL',
  'MEETUP_OUTSIDER_PASSWORD',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing: ${missing.join(', ')}`);
  process.exit(2);
}

const TOPIC = `meetup:${groupId}`;
const JOIN_TIMEOUT_MS = 10_000;
const QUIET_MS = 3_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newClient() {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signedIn(label) {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({
    email: process.env[`MEETUP_${label}_EMAIL`],
    password: process.env[`MEETUP_${label}_PASSWORD`],
  });
  if (error) throw new Error(`${label} could not sign in: ${error.message}`);
  return client;
}

// Joins the topic and resolves with how it ended: 'SUBSCRIBED', 'CHANNEL_ERROR' or 'TIMED_OUT'.
function join(client, { isPrivate, received }) {
  const channel = client.channel(TOPIC, { config: { private: isPrivate } });
  channel.on('broadcast', { event: 'position' }, ({ payload }) => received.push(payload));
  const outcome = new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMED_OUT'), JOIN_TIMEOUT_MS);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        resolve(status);
      }
    });
  });
  return { channel, outcome };
}

let failures = 0;
function check(name, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const memberA = await signedIn('MEMBER_A');
const memberB = await signedIn('MEMBER_B');
const outsider = await signedIn('OUTSIDER');
const anonymous = newClient();

// 1. Members get in, and hear each other.
const aReceived = [];
const a = join(memberA, { isPrivate: true, received: aReceived });
const b = join(memberB, { isPrivate: true, received: [] });
check('member A joins the private channel', (await a.outcome) === 'SUBSCRIBED');
check('member B joins the private channel', (await b.outcome) === 'SUBSCRIBED');

// 2. Everyone else is turned away from the private channel.
const outsiderPrivateReceived = [];
const outsiderPrivate = join(outsider, { isPrivate: true, received: outsiderPrivateReceived });
const outsiderOutcome = await outsiderPrivate.outcome;
check('a signed-in non-member is rejected from the private channel', outsiderOutcome !== 'SUBSCRIBED', outsiderOutcome);

const anonymousPrivate = join(anonymous, { isPrivate: true, received: [] });
const anonymousOutcome = await anonymousPrivate.outcome;
check('a client that is not signed in is rejected from the private channel', anonymousOutcome !== 'SUBSCRIBED', anonymousOutcome);

// 3. A public channel with the same name is a different channel: it hears nothing.
const outsiderPublicReceived = [];
const outsiderPublic = join(outsider, { isPrivate: false, received: outsiderPublicReceived });
await outsiderPublic.outcome;

await b.channel.send({ type: 'broadcast', event: 'position', payload: { id: 'test', lat: 0, lng: 0, acc: 1, t: Date.now() } });
await sleep(QUIET_MS);

check('member A receives member B\'s position', aReceived.length === 1, `${aReceived.length} received`);
check('the non-member receives nothing on the private channel', outsiderPrivateReceived.length === 0);
check('the non-member receives nothing on a public channel with the same name', outsiderPublicReceived.length === 0);

// 4. A non-member can't send into the group either.
const before = aReceived.length;
await outsiderPublic.channel
  .send({ type: 'broadcast', event: 'position', payload: { id: 'intruder', lat: 1, lng: 1, acc: 1, t: Date.now() } })
  .catch(() => {});
await sleep(QUIET_MS);
check('a non-member\'s message does not reach the members', aReceived.length === before);

for (const client of [memberA, memberB, outsider, anonymous]) {
  await client.removeAllChannels();
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
