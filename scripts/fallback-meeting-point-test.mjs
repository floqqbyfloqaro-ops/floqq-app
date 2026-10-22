// Checks, against the TEST Supabase project only, that a confirmed group always gets a meeting
// point (supabase/migrations/20261013000000_fallback_and_test_meeting_points.sql):
//   - before its own point is saved, "Find your group" already shows the terminal's fallback,
//     marked provisional;
//   - with no verified point active at the terminal, the minute-by-minute job gives the group that
//     fallback and records it, so the admin is told;
//   - after that, the fallback is the group's own point (no longer provisional).
// It creates its own throwaway users, rides and group and deletes them again at the end.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY,
// TEST_CRON_SECRET. Run with:
//   node --env-file=.env.test.local scripts/fallback-meeting-point-test.mjs

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

// The live project. This script creates and deletes users, rides and groups: it refuses to run there.
const LIVE_PROJECT_REF = 'notpvjikdbbelrdgplkc';

const url = process.env.TEST_SUPABASE_URL;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.TEST_CRON_SECRET;
const missing = ['TEST_SUPABASE_URL', 'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SERVICE_ROLE_KEY', 'TEST_CRON_SECRET'].filter(
  (name) => !process.env[name]
);
if (missing.length) {
  console.error(`Missing in .env.test.local: ${missing.join(', ')}`);
  process.exit(2);
}
if (url.includes(LIVE_PROJECT_REF)) {
  console.error('TEST_SUPABASE_URL points at the LIVE project. This script only runs against the test project.');
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceRoleKey, options);
const runId = randomUUID().slice(0, 8);
const password = `Test-${randomUUID()}`;

const MINUTE = 60_000;
// Two days ahead, so nothing expires these rides while the script runs.
const ARRIVAL = new Date(Math.floor((Date.now() + 2 * 24 * 60 * MINUTE) / MINUTE) * MINUTE);

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const createdUsers = [];
let groupId = null;

async function createRide(label) {
  const email = `fallback-test-${runId}-${label}@example.com`;
  const { data: created, error: userError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (userError) throw new Error(`creating a test user failed: ${userError.message}`);
  createdUsers.push(created.user);
  const { data, error } = await service
    .from('passenger_requests')
    .insert({
      user_id: created.user.id,
      passenger_name: `Test ${label}`,
      flight_number: '',
      arrival_at: ARRIVAL.toISOString(),
      arrival_time_source: 'manual',
      arrival_terminal: 'T1',
      arrival_terminal_source: 'passenger',
      destination_address: 'Plaça de Catalunya, Barcelona',
      destination_lat: 41.387,
      destination_lng: 2.17,
      large_luggage_count: 0,
      hand_luggage_count: 1,
      max_wait_minutes: 15,
    })
    .select('id')
    .single();
  if (error) throw new Error(`creating the ${label} ride failed: ${error.message}`);
  return { id: data.id, user: created.user, email };
}

async function findGroupAs(ride) {
  const client = createClient(url, anonKey, options);
  const { error: signInError } = await client.auth.signInWithPassword({ email: ride.email, password });
  if (signInError) throw new Error(`signing in failed: ${signInError.message}`);
  const { data, error } = await client.functions.invoke('find-group', { body: { requestId: ride.id } });
  if (error) throw new Error(`find-group failed: ${error.message}`);
  return data.meetup;
}

try {
  const { data: activeRegular } = await service
    .from('meeting_points')
    .select('short_code')
    .eq('terminal', 'T1')
    .eq('is_active', true)
    .neq('kind', 'fallback');
  if ((activeRegular ?? []).length > 0) {
    throw new Error(
      `T1 has active points (${activeRegular.map((p) => p.short_code).join(', ')}): deactivate them to test the fallback`
    );
  }

  const anna = await createRide('anna');
  const ben = await createRide('ben');

  const { data: group, error: groupError } = await service
    .from('taxi_groups')
    .insert({ created_by: anna.user.id, status: 'confirmed' })
    .select('id')
    .single();
  if (groupError) throw new Error(`creating the group failed: ${groupError.message}`);
  groupId = group.id;
  const { error: matchError } = await service
    .from('passenger_requests')
    .update({ group_id: groupId, status: 'matched' })
    .in('id', [anna.id, ben.id]);
  if (matchError) throw new Error(`matching the rides failed: ${matchError.message}`);

  const before = await findGroupAs(anna);
  check(
    'right after confirmation: "Find your group" shows the T1 fallback, marked provisional',
    before?.meetingPoint?.short_code === 'T1-FALLBACK' && before?.meetingPointProvisional === true,
    `${before?.meetingPoint?.short_code ?? 'no point'}, provisional ${before?.meetingPointProvisional}`
  );

  const response = await fetch(`${url}/functions/v1/match-offer-sweep`, {
    method: 'POST',
    headers: { 'x-cron-secret': cronSecret, 'Content-Type': 'application/json' },
    body: '{}',
  });
  check('the minute-by-minute job ran', response.ok, `HTTP ${response.status}`);

  const { data: saved } = await service
    .from('taxi_groups')
    .select('meeting_point:meeting_points(short_code, kind)')
    .eq('id', groupId)
    .single();
  check(
    'the job gave the group the T1 fallback',
    saved?.meeting_point?.short_code === 'T1-FALLBACK' && saved?.meeting_point?.kind === 'fallback',
    saved?.meeting_point?.short_code ?? 'no point'
  );

  const { data: events } = await service
    .from('group_events')
    .select('details')
    .eq('group_id', groupId)
    .eq('event_type', 'meeting_point_assigned');
  check(
    'the assignment is recorded as a fallback (what flags it for the admin)',
    (events ?? []).some((event) => event.details?.fallback === true),
    JSON.stringify(events?.[0]?.details ?? null)
  );

  const after = await findGroupAs(ben);
  check(
    'afterwards: the other member sees the same fallback, no longer provisional',
    after?.meetingPoint?.short_code === 'T1-FALLBACK' && after?.meetingPointProvisional === false,
    `${after?.meetingPoint?.short_code ?? 'no point'}, provisional ${after?.meetingPointProvisional}`
  );
} catch (err) {
  failures += 1;
  console.error(`FAIL  ${err instanceof Error ? err.message : err}`);
} finally {
  console.log('Deleting the test group, users and their rides...');
  if (groupId) {
    await service.from('passenger_requests').update({ group_id: null }).eq('group_id', groupId);
    await service.from('group_events').delete().eq('group_id', groupId);
    const { error } = await service.from('taxi_groups').delete().eq('id', groupId);
    if (error) console.warn(`could not delete the group: ${error.message}`);
  }
  for (const user of createdUsers) {
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.warn(`could not delete ${user.email}: ${error.message}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
