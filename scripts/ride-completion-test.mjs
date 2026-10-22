// Checks, against the TEST Supabase project only, "Ride completed" on the server
// (supabase/migrations/20261023010000_ride_completion_and_ratings.sql):
//   - "I've arrived" completes only that passenger's ride, with an audit event; a completed ride
//     is no longer the passenger's active ride;
//   - the taxi receipt completes everyone else, and with them the group's ride;
//   - rides started 3+ hours ago are completed by the minute-by-minute job, to be shown once;
//   - each passenger's summary holds their own figures only;
//   - ratings: saved, changeable, private to the passenger (and the admin).
// It creates its own throwaway users, rides and groups and deletes them again at the end.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY,
// TEST_CRON_SECRET. Run with:
//   node --env-file=.env.test.local scripts/ride-completion-test.mjs

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
const HOUR = 60 * 60_000;

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const createdUsers = [];
const createdGroups = [];

async function createPassenger(label, distanceKm) {
  const email = `completion-test-${runId}-${label}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: label, last_name: 'Test', date_of_birth: '1990-05-05' },
  });
  if (error) throw new Error(`creating ${label} failed: ${error.message}`);
  createdUsers.push(data.user);
  // Landed two hours ago: the ride is long past its meetup.
  const { data: ride, error: rideError } = await service
    .from('passenger_requests')
    .insert({
      user_id: data.user.id,
      passenger_name: `${label} Test`,
      flight_number: '',
      arrival_at: new Date(Date.now() - 2 * HOUR).toISOString(),
      arrival_time_source: 'manual',
      arrival_terminal: 'T1',
      arrival_terminal_source: 'passenger',
      destination_address: 'Barcelona',
      destination_lat: 41.387,
      destination_lng: 2.17,
      large_luggage_count: 0,
      hand_luggage_count: 1,
      max_wait_minutes: 15,
      distance_km: distanceKm,
    })
    .select('id')
    .single();
  if (rideError) throw new Error(`creating ${label}'s ride failed: ${rideError.message}`);
  const client = createClient(url, anonKey, options);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signing in ${label} failed: ${signInError.message}`);
  return { user: data.user, rideId: ride.id, client, email };
}

async function startedGroup(members, startedHoursAgo) {
  const payer = members[members.length - 1];
  const { data: group, error } = await service
    .from('taxi_groups')
    .insert({
      created_by: members[0].user.id,
      status: 'confirmed',
      total_fare: 75,
      ride_started_at: new Date(Date.now() - startedHoursAgo * HOUR).toISOString(),
      payer_request_id: payer.rideId,
      payer_user_id: payer.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(`creating a group failed: ${error.message}`);
  createdGroups.push(group.id);
  const { error: matchError } = await service
    .from('passenger_requests')
    .update({ group_id: group.id, status: 'matched' })
    .in('id', members.map((m) => m.rideId));
  if (matchError) throw new Error(`matching failed: ${matchError.message}`);
  return group.id;
}

const rideOf = async (id) =>
  (await service.from('passenger_requests').select('completed_at, completed_source, completion_seen_at').eq('id', id).single()).data;
const groupOf = async (id) => (await service.from('taxi_groups').select('completed_at, receipt_received_at').eq('id', id).single()).data;
const eventsOf = async (groupId, type) =>
  (await service.from('group_events').select('request_id, details').eq('group_id', groupId).eq('event_type', type)).data ?? [];

try {
  // --- Group 1: Anna (first stop), Ben, Carl (last stop: the payer) ---
  const anna = await createPassenger('Anna', 5);
  const ben = await createPassenger('Ben', 9);
  const carl = await createPassenger('Carl', 14);
  const group1 = await startedGroup([anna, ben, carl], 0.5);

  const { error: arriveError } = await anna.client.rpc('mark_my_ride_arrived', { p_request_id: anna.rideId });
  const annaRide = await rideOf(anna.rideId);
  check(
    "\"I've arrived\" completes Anna's ride only",
    !arriveError && annaRide?.completed_source === 'passenger' && (await rideOf(ben.rideId))?.completed_at == null,
    arriveError?.message ?? annaRide?.completed_source
  );
  check('...recorded as passenger_arrived', (await eventsOf(group1, 'passenger_arrived')).some((e) => e.request_id === anna.rideId));
  check('...and the group is not completed yet', (await groupOf(group1))?.completed_at == null);

  const { error: notMine } = await ben.client.rpc('mark_my_ride_arrived', { p_request_id: anna.rideId });
  check("nobody can complete someone else's ride", notMine?.code === '42501', notMine?.message);

  const { data: annaActive } = await anna.client.rpc('get_my_active_request');
  const { data: benActive } = await ben.client.rpc('get_my_active_request');
  check(
    "a completed ride is no longer Anna's active ride; Ben's still is",
    (annaActive ?? []).length === 0 && (benActive ?? []).length === 1
  );
  const { data: nextRide, error: nextRideError } = await anna.client
    .from('passenger_requests')
    .insert({
      user_id: anna.user.id,
      flight_number: '',
      arrival_at: new Date(Date.now() + 48 * HOUR).toISOString(),
      arrival_time_source: 'manual',
      arrival_terminal: 'T1',
      arrival_terminal_source: 'passenger',
      destination_address: 'Barcelona',
      destination_lat: 41.387,
      destination_lng: 2.17,
      large_luggage_count: 0,
      hand_luggage_count: 1,
      max_wait_minutes: 15,
    })
    .select('id')
    .single();
  check('...so Anna can book her next ride straight away', !nextRideError, nextRideError?.message);
  if (nextRide) await service.from('passenger_requests').delete().eq('id', nextRide.id);

  // The summary, before the receipt: Anna's own figures, estimated.
  const { data: before, error: summaryError } = await anna.client.functions.invoke('ride-summary', { body: { requestId: anna.rideId } });
  check(
    "Anna's summary: her estimated share of the €75 fare, no receipt yet, not the payer",
    !summaryError &&
      before?.summary?.estimatedTotalCents === 7500 &&
      before.summary.estimatedShareCents > 0 &&
      before.summary.receipt === null &&
      before.summary.isPayer === false,
    summaryError?.message ?? JSON.stringify(before?.summary && { t: before.summary.estimatedTotalCents, s: before.summary.estimatedShareCents })
  );
  const { error: otherSummary } = await ben.client.functions.invoke('ride-summary', { body: { requestId: anna.rideId } });
  check("nobody can read someone else's summary", otherSummary != null);

  // The receipt comes in: the payer (last stop) is out, so everyone is.
  const { error: receiptError } = await service.from('ride_receipts').insert({
    group_id: group1,
    payer_request_id: carl.rideId,
    payer_user_id: carl.user.id,
    total_cents: 8200,
    payer_share_cents: 3000,
    reimbursement_cents: 5200,
    holds_total_cents: 9000,
  });
  const benRide = await rideOf(ben.rideId);
  const carlRide = await rideOf(carl.rideId);
  const group1After = await groupOf(group1);
  check(
    'the receipt completes Ben and Carl, and the group',
    !receiptError &&
      benRide?.completed_source === 'receipt' &&
      carlRide?.completed_source === 'receipt' &&
      group1After?.completed_at != null &&
      (await rideOf(anna.rideId))?.completed_source === 'passenger',
    receiptError?.message ?? `${benRide?.completed_source}/${carlRide?.completed_source}`
  );
  check('...recorded as ride_completed', (await eventsOf(group1, 'ride_completed')).length === 1);

  const { data: after } = await anna.client.functions.invoke('ride-summary', { body: { requestId: anna.rideId } });
  check(
    "Anna's summary now has the receipt total, but not the payer's own figures",
    after?.summary?.receipt?.totalCents === 8200 && after.summary.receipt.payerShareCents === null && after.summary.receipt.reimbursementCents === null,
    JSON.stringify(after?.summary?.receipt)
  );
  const { data: carlSummary } = await carl.client.functions.invoke('ride-summary', { body: { requestId: carl.rideId } });
  check(
    "the payer's summary has their own share and what comes back to them",
    carlSummary?.summary?.isPayer === true && carlSummary.summary.receipt?.payerShareCents === 3000 && carlSummary.summary.receipt?.reimbursementCents === 5200
  );

  // --- Ratings ---
  const { error: rateError } = await anna.client.rpc('save_my_rating', {
    p_request_id: anna.rideId,
    p_stars: 3,
    p_reasons: ['meeting_point', 'other_passengers'],
    p_comment: '  The meeting point was hard to find.  ',
  });
  const { data: annaRating } = await anna.client.from('ride_ratings').select('stars, reasons, comment').eq('request_id', anna.rideId).maybeSingle();
  check(
    'a 3-star rating with reasons and a comment is saved',
    !rateError && annaRating?.stars === 3 && annaRating.reasons.length === 2 && annaRating.comment === 'The meeting point was hard to find.',
    rateError?.message ?? JSON.stringify(annaRating)
  );
  const { data: benSees } = await ben.client.from('ride_ratings').select('id').eq('request_id', anna.rideId);
  check("other passengers can't see it", (benSees ?? []).length === 0);

  const { error: skipError } = await ben.client.rpc('save_my_rating', { p_request_id: ben.rideId, p_stars: 2, p_reasons: [], p_comment: null });
  check('"Skip" keeps the stars alone', !skipError, skipError?.message);

  await anna.client.rpc('save_my_rating', { p_request_id: anna.rideId, p_stars: 5, p_reasons: ['app'], p_comment: 'x' });
  const { data: changed } = await anna.client.from('ride_ratings').select('stars, reasons, comment').eq('request_id', anna.rideId).maybeSingle();
  check(
    'changing it to 5 stars keeps one rating, without reasons or comment',
    changed?.stars === 5 && changed.reasons.length === 0 && changed.comment === null,
    JSON.stringify(changed)
  );
  const { count: annaRatings } = await service.from('ride_ratings').select('id', { count: 'exact', head: true }).eq('request_id', anna.rideId);
  check('...one rating per passenger per ride', annaRatings === 1, String(annaRatings));

  const { error: badReason } = await carl.client.rpc('save_my_rating', { p_request_id: carl.rideId, p_stars: 3, p_reasons: ['nonsense'], p_comment: null });
  const { error: longComment } = await carl.client.rpc('save_my_rating', {
    p_request_id: carl.rideId,
    p_stars: 3,
    p_reasons: [],
    p_comment: 'a'.repeat(501),
  });
  check('an unknown reason or a comment over 500 characters is refused', badReason != null && longComment != null);

  // --- Group 2: started 4 hours ago, nobody tapped: the job completes it ---
  const dora = await createPassenger('Dora', 6);
  const emil = await createPassenger('Emil', 11);
  const { error: notDone } = await dora.client.rpc('save_my_rating', { p_request_id: dora.rideId, p_stars: 4, p_reasons: [], p_comment: null });
  check("a ride that isn't completed can't be rated", notDone?.message === 'ride_not_completed', notDone?.message);
  const group2 = await startedGroup([dora, emil], 4);
  const sweep = await fetch(`${url}/functions/v1/match-offer-sweep`, {
    method: 'POST',
    headers: { 'x-cron-secret': cronSecret, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const doraRide = await rideOf(dora.rideId);
  check(
    'a ride started 4 hours ago is completed automatically, not yet seen',
    sweep.ok && doraRide?.completed_source === 'auto' && doraRide.completion_seen_at == null && (await groupOf(group2))?.completed_at != null,
    `HTTP ${sweep.status}, ${doraRide?.completed_source}`
  );
  await dora.client.rpc('mark_my_completion_seen', { p_request_id: dora.rideId });
  check('"Ride completed" is shown once: marked as seen', (await rideOf(dora.rideId))?.completion_seen_at != null);

  // --- The admin's overview ---
  const admin = await createPassenger('Ada', 1);
  await service.from('user_roles').insert({ user_id: admin.user.id, role: 'admin' });
  const { data: overview, error: overviewError } = await admin.client.rpc('admin_rating_summary', { p_days: 1 });
  const { error: notAdmin } = await anna.client.rpc('admin_rating_summary', { p_days: 1 });
  // The admin's "latest ratings" list (src/components/AdminRatings.tsx): with a comment or 1-2 stars.
  const { data: latest, error: latestError } = await admin.client
    .from('ride_ratings')
    .select('id, group_id, stars, reasons, comment, created_at, passenger_requests(passenger_name, destination_address)')
    .or('comment.not.is.null,stars.lte.2')
    .order('created_at', { ascending: false })
    .limit(20);
  const bensRating = (latest ?? []).find((row) => row.group_id === group1 && row.stars === 2);
  check(
    "the admin's latest list holds Ben's 2-star rating, with his ride",
    !latestError && bensRating?.passenger_requests?.passenger_name === 'Ben Test',
    latestError?.message ?? JSON.stringify(bensRating?.passenger_requests ?? null)
  );
  const { count: annaListed } = await anna.client.from('ride_ratings').select('id', { count: 'exact', head: true }).neq('user_id', anna.user.id);
  check("a passenger's list never holds anyone else's rating", annaListed === 0, String(annaListed));

  check(
    'the admin sees the overview; a passenger cannot',
    !overviewError && overview?.count >= 2 && notAdmin?.code === '42501',
    overviewError?.message ?? JSON.stringify(overview)
  );
} catch (err) {
  failures += 1;
  console.error(`FAIL  ${err instanceof Error ? err.message : err}`);
} finally {
  console.log('Deleting the test groups, users and their rides...');
  for (const groupId of createdGroups) {
    await service.from('ride_receipts').delete().eq('group_id', groupId);
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
