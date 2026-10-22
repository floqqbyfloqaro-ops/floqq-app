// Checks, against the TEST Supabase project only, the profile rules on the server
// (supabase/migrations/20261022000000_profiles_and_minimum_age.sql) - straight against the
// database, the way someone bypassing the app would:
//   - an account with a date of birth under 18 is never created; exactly 18 today is;
//   - an existing account without a date of birth can't create a ride; one under 18 is flagged
//     and can't create or edit one; the date is set once and can't be changed by its owner;
//   - names: accents, hyphens and apostrophes accepted, invalid ones refused, open rides follow;
//   - the admin corrects a date of birth, with an audit event; nobody else can;
//   - a pending email change can be cancelled; another account's email is refused.
// It creates its own throwaway users and rides and deletes them again at the end.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Run with:
//   node --env-file=.env.test.local scripts/profile-age-test.mjs

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

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

// Today in Barcelona, and a date of birth that many years (and days) before it.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
function bornYearsAgo(years, extraDays = 0) {
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y - years, m - 1, d));
  date.setUTCDate(date.getUTCDate() + extraDays);
  return date.toISOString().slice(0, 10);
}
const EXACTLY_18 = bornYearsAgo(18);
// 17 years and 364 days old: turns 18 tomorrow.
const ONE_DAY_SHORT = bornYearsAgo(18, 1);

const createdUsers = [];
const emailOf = (label) => `profile-test-${runId}-${label}@example.com`;
async function createUser(label, metadata = {}) {
  const email = emailOf(label);
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata });
  if (data?.user) createdUsers.push(data.user);
  return { user: data?.user ?? null, error, email };
}
async function signIn(email) {
  const client = createClient(url, anonKey, options);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signing in failed: ${error.message}`);
  return client;
}
const profileOf = async (userId) =>
  (await service.from('profiles').select('*').eq('user_id', userId).maybeSingle()).data;

const ARRIVAL = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString();
const rideFields = (userId) => ({
  user_id: userId,
  passenger_name: 'From the app',
  flight_number: '',
  arrival_at: ARRIVAL,
  arrival_time_source: 'manual',
  arrival_terminal: 'T1',
  arrival_terminal_source: 'passenger',
  destination_address: 'Plaça de Catalunya, Barcelona',
  destination_lat: 41.387,
  destination_lng: 2.17,
  large_luggage_count: 0,
  hand_luggage_count: 1,
  max_wait_minutes: 15,
});
async function createRideAs(client, userId) {
  return client.from('passenger_requests').insert(rideFields(userId)).select('id, passenger_name').single();
}

try {
  // --- Sign-up and the minimum age ---
  const young = await createUser('young', { first_name: 'Young', last_name: 'Person', date_of_birth: ONE_DAY_SHORT });
  check(
    'sign-up with a date of birth of 17 years and 364 days is refused',
    young.error != null && young.user == null,
    young.error?.message ?? 'account was created'
  );
  const { data: youngLookup } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  check(
    '...and no account or data is kept',
    !(youngLookup?.users ?? []).some((u) => u.email === young.email)
  );

  const adult = await createUser('adult', { first_name: 'Anna', last_name: 'Adult', date_of_birth: EXACTLY_18 });
  check('sign-up exactly 18 today is accepted', adult.user != null, adult.error?.message ?? EXACTLY_18);
  const adultProfile = adult.user ? await profileOf(adult.user.id) : null;
  check(
    '...with a profile holding the names and the date of birth',
    adultProfile?.first_name === 'Anna' && adultProfile?.last_name === 'Adult' && adultProfile?.date_of_birth === EXACTLY_18,
    JSON.stringify(adultProfile && { f: adultProfile.first_name, l: adultProfile.last_name, d: adultProfile.date_of_birth })
  );

  const google = await createUser('google', { full_name: 'María José García López' });
  const googleProfile = google.user ? await profileOf(google.user.id) : null;
  check(
    'an account without first/last name gets them split from its full name',
    googleProfile?.first_name === 'María' && googleProfile?.last_name === 'José García López',
    JSON.stringify(googleProfile && [googleProfile.first_name, googleProfile.last_name])
  );

  // --- Rides need a date of birth showing 18 or older ---
  const noDob = await createUser('nodob', { full_name: 'Nico Nodate' });
  const asNoDob = await signIn(noDob.email);
  const { error: noDobRide } = await createRideAs(asNoDob, noDob.user.id);
  check('an existing account without a date of birth cannot create a ride', noDobRide?.message === 'date_of_birth_required', noDobRide?.message);

  const { data: setYoung, error: setYoungError } = await asNoDob.rpc('set_my_date_of_birth', { p_date_of_birth: ONE_DAY_SHORT });
  const flagged = await profileOf(noDob.user.id);
  check(
    'an existing account entering an under-18 date: kept, flagged',
    setYoung?.status === 'under_age' && flagged?.under_age_at != null,
    setYoungError?.message ?? JSON.stringify(setYoung)
  );
  const { error: youngRide } = await createRideAs(asNoDob, noDob.user.id);
  check('...and its rides are refused', youngRide?.message === 'under_age', youngRide?.message);

  const { error: changeAgain } = await asNoDob.rpc('set_my_date_of_birth', { p_date_of_birth: '1990-01-01' });
  check('the date of birth is set once: a second one is refused', changeAgain?.message === 'date_of_birth_locked', changeAgain?.message);

  const { data: directWrite } = await asNoDob
    .from('profiles')
    .update({ date_of_birth: '1990-01-01' })
    .eq('user_id', noDob.user.id)
    .select('user_id');
  const afterDirect = await profileOf(noDob.user.id);
  check(
    'writing the date of birth straight to the table changes nothing',
    (directWrite ?? []).length === 0 && afterDirect?.date_of_birth === ONE_DAY_SHORT,
    afterDirect?.date_of_birth
  );

  const { error: serviceWrite } = await service.from('profiles').update({ date_of_birth: '1990-01-01' }).eq('user_id', noDob.user.id);
  check('...not even with full database access, outside the admin correction', serviceWrite?.message === 'date_of_birth_locked', serviceWrite?.message);

  // --- Names ---
  const asAdult = await signIn(adult.email);
  const { data: ride, error: rideError } = await createRideAs(asAdult, adult.user.id);
  check(
    'an adult can create a ride, and it carries the profile name',
    !rideError && ride?.passenger_name === 'Anna Adult',
    rideError?.message ?? ride?.passenger_name
  );

  const { error: nameError } = await asAdult.rpc('update_my_name', { p_first_name: '  Anne   Marie ', p_last_name: "O’Neil-Smith" });
  const { data: rideAfter } = await service.from('passenger_requests').select('passenger_name').eq('id', ride?.id).single();
  check(
    'a name with spaces, an apostrophe and a hyphen is saved, tidied, and the open ride follows',
    !nameError && rideAfter?.passenger_name === 'Anne Marie O’Neil-Smith',
    nameError?.message ?? rideAfter?.passenger_name
  );

  for (const [first, last] of [['José', 'García'], ['Zoë', "'t Hooft"], ['Ζωή', 'Παπαδοπούλου'], ['Łukasz', 'Wiśniewski']]) {
    const { error } = await asAdult.rpc('update_my_name', { p_first_name: first, p_last_name: last });
    check(`accepted: ${first} ${last}`, !error, error?.message);
  }
  for (const [first, last, expected] of [
    ['J0sé', 'García', 'invalid_first_name'],
    ['', 'García', 'invalid_first_name'],
    ['José', 'Bob!', 'invalid_last_name'],
    ['A'.repeat(51), 'García', 'invalid_first_name'],
  ]) {
    const { error } = await asAdult.rpc('update_my_name', { p_first_name: first, p_last_name: last });
    check(`refused: "${first.slice(0, 12)}" "${last}"`, error?.message === expected, error?.message ?? 'accepted');
  }

  // --- The admin ---
  const { error: notAdmin } = await asAdult.rpc('admin_set_date_of_birth', {
    p_user_id: noDob.user.id,
    p_date_of_birth: '1990-01-01',
    p_note: 'test',
  });
  check('a passenger cannot use the admin correction', notAdmin?.code === '42501', notAdmin?.message);

  const admin = await createUser('admin', { full_name: 'Ada Admin' });
  await service.from('user_roles').insert({ user_id: admin.user.id, role: 'admin' });
  const asAdmin = await signIn(admin.email);
  const { data: flaggedList } = await asAdmin.rpc('admin_under_age_accounts');
  check(
    'the admin sees the flagged account',
    (flaggedList ?? []).some((row) => row.user_id === noDob.user.id && row.still_under_age === true)
  );
  const { data: found } = await asAdmin.rpc('admin_find_account', { p_email: noDob.email.toUpperCase() });
  check('the admin finds an account by its email', found?.[0]?.user_id === noDob.user.id);
  const { data: corrected, error: correctError } = await asAdmin.rpc('admin_set_date_of_birth', {
    p_user_id: noDob.user.id,
    p_date_of_birth: '1990-01-01',
    p_note: 'Typo, checked passport',
  });
  const afterCorrection = await profileOf(noDob.user.id);
  const { data: events } = await service
    .from('profile_events')
    .select('event_type, details, actor_type')
    .eq('user_id', noDob.user.id)
    .eq('event_type', 'date_of_birth_corrected');
  check(
    'the admin corrects the date: the flag is lifted and an audit event records from/to/note',
    !correctError &&
      corrected?.applied === true &&
      afterCorrection?.date_of_birth === '1990-01-01' &&
      afterCorrection?.under_age_at == null &&
      events?.[0]?.details?.from === ONE_DAY_SHORT &&
      events?.[0]?.details?.to === '1990-01-01' &&
      events?.[0]?.actor_type === 'admin',
    correctError?.message ?? JSON.stringify(events?.[0]?.details)
  );
  const { error: rideNowOk } = await createRideAs(asNoDob, noDob.user.id);
  check('...after which that account can create rides', !rideNowOk, rideNowOk?.message);

  // --- Email changes ---
  const { error: duplicate } = await asAdult.auth.updateUser({ email: google.email });
  check(
    "changing to another account's email is refused",
    duplicate != null && /already|exists|registered/i.test(`${duplicate.code} ${duplicate.message}`),
    `${duplicate?.code} ${duplicate?.message}`
  );

  const newEmail = emailOf('adult-new');
  const { error: linkError } = await service.auth.admin.generateLink({ type: 'email_change_new', email: adult.email, newEmail });
  const { data: pending } = await service.auth.admin.getUserById(adult.user.id);
  check(
    'an email change waits for confirmation: the old email stays active',
    !linkError && pending?.user?.new_email === newEmail && pending?.user?.email === adult.email,
    linkError?.message ?? `email ${pending?.user?.email}, new ${pending?.user?.new_email}`
  );
  const { error: cancelError } = await asAdult.rpc('cancel_my_email_change');
  const { data: cancelled } = await service.auth.admin.getUserById(adult.user.id);
  check(
    'cancelling it clears the pending change',
    !cancelError && !cancelled?.user?.new_email && cancelled?.user?.email === adult.email,
    cancelError?.message ?? `new ${cancelled?.user?.new_email}`
  );

  // Confirming: with secure email change, a link to the current and one to the new address. The
  // links are generated here instead of emailed, and opened like a browser would. (Links made this
  // way land on the project's site URL: where the app's own links land, set by the app's request,
  // is checked on a phone.)
  const changer = await createUser('changer', { full_name: 'Carla Changer' });
  const changedEmail = emailOf('changer-new');
  const { data: currentLink } = await service.auth.admin.generateLink({
    type: 'email_change_current',
    email: changer.email,
    newEmail: changedEmail,
  });
  const { data: newLink } = await service.auth.admin.generateLink({
    type: 'email_change_new',
    email: changer.email,
    newEmail: changedEmail,
  });
  const firstHop = await fetch(currentLink.properties.action_link, { redirect: 'manual' });
  const { data: halfway } = await service.auth.admin.getUserById(changer.user.id);
  check(
    'after the first link only: the old email is still the active one',
    halfway?.user?.email === changer.email,
    `HTTP ${firstHop.status}, email ${halfway?.user?.email}`
  );
  await fetch(newLink.properties.action_link, { redirect: 'manual' });
  const { data: changed } = await service.auth.admin.getUserById(changer.user.id);
  check(
    'after both links: the new email is the active one',
    changed?.user?.email === changedEmail && !changed?.user?.new_email,
    `email ${changed?.user?.email}`
  );
} catch (err) {
  failures += 1;
  console.error(`FAIL  ${err instanceof Error ? err.message : err}`);
} finally {
  console.log('Deleting the test users and their rides...');
  for (const user of createdUsers) {
    await service.from('passenger_requests').delete().eq('user_id', user.id);
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.warn(`could not delete ${user.email}: ${error.message}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
