// Checks, against the TEST Supabase project only, that the database calculates each ride's ready
// time as designed (supabase/migrations/20261012050000_ready_time.sql):
//   gate arrival + a buffer by kind of flight (Schengen or not, from the origin airport) and
//   checked luggage; rides without a flight number by their answer to the luggage question.
// It creates its own throwaway users and rides and deletes them again at the end.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Run with:
//   node --env-file=.env.test.local scripts/ready-time-test.mjs

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

// The live project. This script creates and deletes users and rides: it refuses to run there.
const LIVE_PROJECT_REF = 'notpvjikdbbelrdgplkc';

const url = process.env.TEST_SUPABASE_URL;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const missing = ['TEST_SUPABASE_URL', 'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SERVICE_ROLE_KEY'].filter(
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
const iso = (date) => date.toISOString();
const clock = (value) => new Date(value).toISOString().slice(11, 16);

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const createdUsers = [];
async function createUser(label) {
  const email = `ready-time-test-${runId}-${label}@example.com`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`creating a test user failed: ${error.message}`);
  createdUsers.push(data.user);
  return data.user;
}

// A ride as the app's request form would save it, each for a user of its own (a passenger has one
// active ride at a time).
async function createRide(label, fields) {
  const user = await createUser(label);
  const { data, error } = await service
    .from('passenger_requests')
    .insert({
      user_id: user.id,
      passenger_name: `Test ${label}`,
      flight_number: '',
      arrival_at: iso(ARRIVAL),
      arrival_time_source: 'manual',
      arrival_terminal: 'T1',
      arrival_terminal_source: 'passenger',
      destination_address: 'Plaça de Catalunya, Barcelona',
      destination_lat: 41.387,
      destination_lng: 2.17,
      large_luggage_count: 0,
      hand_luggage_count: 1,
      max_wait_minutes: 15,
      ...fields,
    })
    .select('id')
    .single();
  if (error) throw new Error(`creating the ${label} ride failed: ${error.message}`);
  return data.id;
}

const COLUMNS = 'arrival_at, flight_category, ready_buffer_minutes, ready_at';
async function read(id) {
  const { data, error } = await service.from('passenger_requests').select(COLUMNS).eq('id', id).single();
  if (error) throw new Error(`reading a ride failed: ${error.message}`);
  return data;
}

// The ride's category and buffer are as expected, and its ready time is its arrival plus that buffer.
function expectReady(label, ride, category, minutes) {
  const gap = (new Date(ride.ready_at).getTime() - new Date(ride.arrival_at).getTime()) / MINUTE;
  check(
    label,
    ride.flight_category === category && ride.ready_buffer_minutes === minutes && gap === minutes,
    `category ${ride.flight_category ?? 'none'}, arrives ${clock(ride.arrival_at)}, ready ${clock(ride.ready_at)} (+${gap} min)`
  );
}

try {
  // The four kinds of flight.
  const boston = await createRide('boston', { flight_number: 'DL250', flight_origin_iata: 'BOS', flight_origin_icao: 'KBOS', large_luggage_count: 1 });
  const madrid = await createRide('madrid', { flight_number: 'IB1234', flight_origin_iata: 'MAD', flight_origin_icao: 'LEMD' });
  const london = await createRide('london', { flight_number: 'BA478', flight_origin_iata: 'LHR', flight_origin_icao: 'EGLL' });
  const zurich = await createRide('zurich', { flight_number: 'LX1952', flight_origin_iata: 'ZRH', flight_origin_icao: 'LSZH', large_luggage_count: 1 });

  expectReady('Boston, checked bag: non-Schengen, ready 60 minutes after the gate', await read(boston), 'non_schengen', 60);
  expectReady('Madrid, hand luggage: Schengen, ready 25 minutes after the gate', await read(madrid), 'schengen', 25);
  expectReady('UK origin, hand luggage: non-Schengen, 45 minutes', await read(london), 'non_schengen', 45);
  expectReady('Zurich, checked bag: Schengen, 40 minutes', await read(zurich), 'schengen', 40);

  const bostonRide = await read(boston);
  const madridRide = await read(madrid);
  const gapMinutes = (new Date(bostonRide.ready_at).getTime() - new Date(madridRide.ready_at).getTime()) / MINUTE;
  check('Boston and Madrid at the gate together are ready 35 minutes apart', gapMinutes === 35, `gap ${gapMinutes} min`);

  // Not EU membership: Ireland is out, Norway is in.
  const dublin = await createRide('dublin', { flight_number: 'EI562', flight_origin_iata: 'DUB', flight_origin_icao: 'EIDW' });
  const oslo = await createRide('oslo', { flight_number: 'DY1740', flight_origin_iata: 'OSL', flight_origin_icao: 'ENGM' });
  expectReady('Ireland: non-Schengen', await read(dublin), 'non_schengen', 45);
  expectReady('Norway: Schengen', await read(oslo), 'schengen', 25);

  // A flight whose origin isn't known yet.
  const unknown = await createRide('unknown', { flight_number: 'XX999' });
  expectReady('origin not known yet: calculated as non-Schengen', await read(unknown), null, 45);

  await service.from('passenger_requests').update({ flight_origin_iata: 'MAD', flight_origin_icao: 'LEMD' }).eq('id', unknown);
  expectReady('...and corrected once flight data names the origin', await read(unknown), 'schengen', 25);

  await service.from('passenger_requests').update({ flight_number: 'YY111' }).eq('id', unknown);
  expectReady('another flight number: the old flight’s origin no longer applies', await read(unknown), null, 45);

  // Without a flight number: the luggage question.
  const collect = await createRide('collect', { luggage_to_collect: true });
  const nothing = await createRide('nothing', { luggage_to_collect: false, large_luggage_count: 1 });
  const unanswered = await createRide('unanswered', { large_luggage_count: 1 });
  expectReady('no flight number, luggage still to collect: 25 minutes', await read(collect), null, 25);
  expectReady('no flight number, nothing to collect (even with large luggage in hand): 15 minutes', await read(nothing), null, 15);
  expectReady('no flight number, question not answered: goes by their large luggage', await read(unanswered), null, 25);

  // A delay moves the ready time with it.
  const delayed = new Date(ARRIVAL.getTime() + 40 * MINUTE);
  await service.from('passenger_requests').update({ arrival_at: iso(delayed) }).eq('id', boston);
  const afterDelay = await read(boston);
  check(
    'a 40-minute delay moves the ready time by 40 minutes',
    new Date(afterDelay.ready_at).getTime() === delayed.getTime() + 60 * MINUTE,
    `arrives ${clock(afterDelay.arrival_at)}, ready ${clock(afterDelay.ready_at)}`
  );

  // Luggage added later.
  await service.from('passenger_requests').update({ large_luggage_count: 1 }).eq('id', madrid);
  expectReady('adding a checked bag to the Madrid ride: 40 minutes', await read(madrid), 'schengen', 40);

  // The buffers are settings, not code.
  await service.from('ready_time_settings').update({ schengen_no_bag_minutes: 30 }).eq('id', true);
  await service.from('passenger_requests').update({ max_wait_minutes: 16 }).eq('id', oslo);
  const withNewSetting = await read(oslo);
  await service.from('ready_time_settings').update({ schengen_no_bag_minutes: 25 }).eq('id', true);
  expectReady('changing a buffer in the settings applies to rides saved after it', withNewSetting, 'schengen', 30);

  // Calibration: only the admin, and the average of (actual - calculated).
  const admin = await createUser('admin');
  await service.from('user_roles').insert({ user_id: admin.id, role: 'admin' });
  const zurichRide = await read(zurich);
  await service
    .from('passenger_requests')
    .update({ meeting_point_arrived_at: iso(new Date(new Date(zurichRide.ready_at).getTime() + 8 * MINUTE)) })
    .eq('id', zurich);

  const signIn = async (user) => {
    const client = createClient(url, anonKey, options);
    const { error } = await client.auth.signInWithPassword({ email: user.email, password });
    if (error) throw new Error(`signing in failed: ${error.message}`);
    return client;
  };
  const asAdmin = await signIn(admin);
  const { data: calibration, error: calibrationError } = await asAdmin.rpc('admin_ready_time_calibration');
  const row = (calibration ?? []).find((r) => r.category === 'schengen' && r.checked_bag === true);
  check(
    'the admin sees the average difference per kind of flight',
    !calibrationError && Number(row?.average_difference_minutes) === 8 && Number(row?.buffer_minutes) === 40,
    calibrationError?.message ?? JSON.stringify(row ?? null)
  );

  const asPassenger = await signIn(createdUsers[0]);
  const { error: refused } = await asPassenger.rpc('admin_ready_time_calibration');
  check('a normal user cannot read the calibration', refused?.code === '42501', `code ${refused?.code}`);

  const { data: settingsSeen } = await asPassenger.from('ready_time_settings').select('id');
  check('a normal user cannot read or change the buffers', (settingsSeen ?? []).length === 0);
} catch (err) {
  failures += 1;
  console.error(`FAIL  ${err instanceof Error ? err.message : err}`);
} finally {
  await service.from('ready_time_settings').update({ schengen_no_bag_minutes: 25 }).eq('id', true);
  console.log('Deleting the test users and their rides...');
  for (const user of createdUsers) {
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.warn(`could not delete ${user.email}: ${error.message}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
