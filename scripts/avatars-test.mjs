// Avatars (20261028010000_avatars.sql, match-offer, find-group), against the TEST Supabase project:
//   - sign-up: the avatar chosen on the sign-up step is the account's; none (Google, older app
//     versions) or a bad value -> a random one of the eight;
//   - existing accounts: each has one, and it doesn't change on later loads or other profile edits;
//   - set_my_avatar: changes it; anything outside 1-99 is refused; not signed in is refused;
//   - privacy: a passenger can't read another's profile;
//   - the group: each member sees the others' avatars in "Match found" and "Find your group", and
//     a change shows the next time the others load them.
// It creates its own throwaway users, rides and group, and deletes them again at the end.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Run with:
//   node --env-file=.env.test.local scripts/avatars-test.mjs

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

// The live project. This script creates and deletes users, rides and groups: it refuses to run there.
const LIVE_PROJECT_REF = 'notpvjikdbbelrdgplkc';

const url = process.env.TEST_SUPABASE_URL;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const missing = ['TEST_SUPABASE_URL', 'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !process.env[name]);
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
const HOUR = 60 * 60_000;
const APP_AVATARS = [1, 2, 3, 4, 5, 6, 7, 8];

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const createdUsers = [];
const createdGroups = [];

// An account as the sign-up form makes it; `avatar` is what the form sends (undefined: nothing).
async function createAccount(label, avatar) {
  const email = `avatars-test-${runId}-${label}@example.com`;
  const metadata = { first_name: label, last_name: 'Test', date_of_birth: '1990-05-05' };
  if (avatar !== undefined) metadata.avatar_id = avatar;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata });
  if (error) throw new Error(`creating ${label} failed: ${error.message}`);
  createdUsers.push(data.user);
  const client = createClient(url, anonKey, options);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signing in ${label} failed: ${signInError.message}`);
  return { user: data.user, client };
}

const avatarOf = async (userId) =>
  (await service.from('profiles').select('avatar_id').eq('user_id', userId).single()).data?.avatar_id ?? null;

async function addRide(account, label, distanceKm) {
  const { data, error } = await service
    .from('passenger_requests')
    .insert({
      user_id: account.user.id,
      passenger_name: `${label} Test`,
      flight_number: '',
      arrival_at: new Date(Date.now() + 2 * HOUR).toISOString(),
      arrival_time_source: 'manual',
      arrival_terminal: 'T1',
      arrival_terminal_source: 'passenger',
      destination_address: 'Barcelona',
      destination_lat: 41.387,
      destination_lng: 2.17,
      destination_neighborhood: 'Eixample',
      large_luggage_count: 0,
      hand_luggage_count: 1,
      max_wait_minutes: 15,
      distance_km: distanceKm,
    })
    .select('id')
    .single();
  if (error) throw new Error(`creating ${label}'s ride failed: ${error.message}`);
  return data.id;
}

// The other members' avatars, as each screen gets them: by first name, from the caller's view.
async function avatarsSeenBy(account, rideId) {
  const { data: offer, error: offerError } = await account.client.functions.invoke('match-offer', { body: { requestId: rideId } });
  const { data: meetup, error: meetupError } = await account.client.functions.invoke('find-group', { body: { requestId: rideId } });
  if (offerError || meetupError) throw new Error(`loading the group failed: ${(offerError ?? meetupError).message}`);
  const byName = (members) => Object.fromEntries((members ?? []).map((m) => [m.isMe ? 'me' : m.firstName, m.avatarId]));
  return { matchFound: byName(offer?.offer?.members), findGroup: byName(meetup?.meetup?.members) };
}

try {
  // --- Sign-up ---
  const chosen = await createAccount('Chosen', 5);
  check('sign-up: the avatar chosen on the sign-up step is saved', (await avatarOf(chosen.user.id)) === 5);

  const asText = await createAccount('AsText', '7');
  check('sign-up: an avatar sent as text is saved too', (await avatarOf(asText.user.id)) === 7);

  const none = await createAccount('None');
  const noneAvatar = await avatarOf(none.user.id);
  check('sign-up without an avatar (Google, older app): a random one of the eight', APP_AVATARS.includes(noneAvatar), `got ${noneAvatar}`);

  for (const bad of [0, 150, -3, 'abc', '5x', 2.5]) {
    const account = await createAccount(`Bad${createdUsers.length}`, bad);
    const avatar = await avatarOf(account.user.id);
    check(`sign-up with a bad avatar (${JSON.stringify(bad)}): a random one of the eight`, APP_AVATARS.includes(avatar), `got ${avatar}`);
  }

  // --- Existing accounts: one each, kept ---
  const { count: withoutAvatar, error: countError } = await service
    .from('profiles')
    .select('user_id', { count: 'exact', head: true })
    .or('avatar_id.is.null,avatar_id.lt.1,avatar_id.gt.8');
  check('every existing profile has one of the eight avatars', !countError && withoutAvatar === 0, `${withoutAvatar} without`);

  const first = await avatarOf(none.user.id);
  const second = await avatarOf(none.user.id);
  await none.client.rpc('update_my_name', { p_first_name: 'None', p_last_name: 'Renamed' });
  const afterRename = await avatarOf(none.user.id);
  check('an assigned avatar stays the same on every load and after a name change', first === second && second === afterRename, `${first}/${second}/${afterRename}`);

  // --- Changing it ---
  const { error: setError } = await chosen.client.rpc('set_my_avatar', { p_avatar_id: 3 });
  check('set_my_avatar changes the avatar', !setError && (await avatarOf(chosen.user.id)) === 3, setError?.message);
  const { data: ownRow } = await chosen.client.from('profiles').select('avatar_id').maybeSingle();
  check('the passenger reads their new avatar back', ownRow?.avatar_id === 3);

  for (const bad of [0, 100, -1, null]) {
    const { error } = await chosen.client.rpc('set_my_avatar', { p_avatar_id: bad });
    check(`set_my_avatar(${bad}) is refused`, error?.message === 'invalid_avatar', error?.message ?? 'accepted');
  }
  check('a refused change leaves the avatar as it was', (await avatarOf(chosen.user.id)) === 3);

  const { error: futureError } = await chosen.client.rpc('set_my_avatar', { p_avatar_id: 9 });
  check('an id a newer app version adds (9) is accepted without a migration', !futureError, futureError?.message);
  await chosen.client.rpc('set_my_avatar', { p_avatar_id: 3 });

  const anonymous = createClient(url, anonKey, options);
  const { error: anonymousError } = await anonymous.rpc('set_my_avatar', { p_avatar_id: 2 });
  check('set_my_avatar is refused when not signed in', !!anonymousError);

  // --- Privacy ---
  const { data: othersRows } = await chosen.client.from('profiles').select('user_id, avatar_id').eq('user_id', none.user.id);
  check("a passenger can't read another passenger's profile", (othersRows ?? []).length === 0);

  // --- The group ---
  const anna = await createAccount('Anna', 1);
  const ben = await createAccount('Ben', 6);
  const annaRide = await addRide(anna, 'Anna', 5);
  const benRide = await addRide(ben, 'Ben', 9);
  const { data: group, error: groupError } = await service
    .from('taxi_groups')
    .insert({ created_by: anna.user.id, status: 'confirmed', total_fare: 40 })
    .select('id')
    .single();
  if (groupError) throw new Error(`creating the group failed: ${groupError.message}`);
  createdGroups.push(group.id);
  const { error: matchError } = await service
    .from('passenger_requests')
    .update({ group_id: group.id, status: 'matched' })
    .in('id', [annaRide, benRide]);
  if (matchError) throw new Error(`matching failed: ${matchError.message}`);

  const before = await avatarsSeenBy(anna, annaRide);
  check('"Match found": Anna sees her own avatar', before.matchFound.me === 1, JSON.stringify(before.matchFound));
  check('"Match found": Anna sees Ben\'s avatar', before.matchFound.Ben === 6);
  check('"Find your group": Anna sees her own avatar', before.findGroup.me === 1, JSON.stringify(before.findGroup));
  check('"Find your group": Anna sees Ben\'s avatar', before.findGroup.Ben === 6);

  const benView = await avatarsSeenBy(ben, benRide);
  check('Ben sees Anna\'s avatar on both screens', benView.matchFound.Anna === 1 && benView.findGroup.Anna === 1);

  await ben.client.rpc('set_my_avatar', { p_avatar_id: 4 });
  const after = await avatarsSeenBy(anna, annaRide);
  check('after Ben changes his avatar, Anna sees the new one on her next load', after.matchFound.Ben === 4 && after.findGroup.Ben === 4, JSON.stringify(after));

  // A member without a profile row (an account from before profiles existed): null, the app's default.
  await service.from('profiles').delete().eq('user_id', ben.user.id);
  const noProfile = await avatarsSeenBy(anna, annaRide);
  check('a member without a profile comes back as null (the app shows its neutral default)', noProfile.matchFound.Ben === null && noProfile.findGroup.Ben === null, JSON.stringify(noProfile));
} catch (error) {
  failures += 1;
  console.error('FAIL  the test stopped:', error.message);
} finally {
  console.log('Deleting the test group, users and their rides...');
  for (const groupId of createdGroups) {
    await service.from('passenger_requests').update({ group_id: null }).eq('group_id', groupId);
    await service.from('group_events').delete().eq('group_id', groupId);
    await service.from('taxi_groups').delete().eq('id', groupId);
  }
  for (const user of createdUsers) {
    await service.from('passenger_requests').delete().eq('user_id', user.id);
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.warn(`could not delete ${user.email}: ${error.message}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
