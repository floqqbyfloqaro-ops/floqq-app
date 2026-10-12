// Checks, against the TEST Supabase project only, that the matcher no longer depends on an admin
// account and that admin-only things still need the admin role:
//   1. With more than 60 users, and the admin outside the first page of the user list, the matcher
//      runs.
//   2. With no admin role at all, the matcher still runs.
//   3. A normal user is refused everything admin-only; a user with the role is let in.
// It creates its own throwaway users and deletes them again at the end.
//
// Put these in .env.test.local (ignored by git):
//   TEST_SUPABASE_URL=...                 the TEST project's URL
//   TEST_SUPABASE_ANON_KEY=...
//   TEST_SUPABASE_SERVICE_ROLE_KEY=...
//   TEST_CRON_SECRET=...                  the TEST project's CRON_SECRET
// The test project needs the migrations applied and the functions deployed.
//
// Run with:
//   node --env-file=.env.test.local scripts/admin-role-test.mjs

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

// The live project. This script creates and deletes users: it refuses to run there.
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

const USER_COUNT = 62;
const runId = randomUUID().slice(0, 8);
const password = `Test-${randomUUID()}`;
const emailFor = (n) => `admin-role-test-${runId}-${n}@example.com`;

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceRoleKey, options);

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

async function runMatcher(headers) {
  const response = await fetch(`${url}/functions/v1/match-and-group`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: '{}',
  });
  const text = await response.text();
  return { status: response.status, text };
}

// A lock left by the previous call can make a run report "already in progress": try once more.
async function runMatcherAsCron() {
  let result = await runMatcher({ 'x-cron-secret': cronSecret });
  if (result.status === 200 && result.text.includes('already in progress')) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    result = await runMatcher({ 'x-cron-secret': cronSecret });
  }
  return result;
}

async function signIn(email) {
  const client = createClient(url, anonKey, options);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signing in as ${email} failed: ${error.message}`);
  return { client, token: data.session.access_token };
}

const created = [];
try {
  console.log(`Creating ${USER_COUNT} test users...`);
  for (let n = 0; n < USER_COUNT; n += 1) {
    const { data, error } = await service.auth.admin.createUser({ email: emailFor(n), password, email_confirm: true });
    if (error) throw new Error(`creating a test user failed: ${error.message}`);
    created.push(data.user);
  }

  // The admin for this test: one of the new users that the first page of the user list does NOT
  // contain - the exact situation in which the old matcher answered "Admin account not found".
  const { data: firstPage, error: listError } = await service.auth.admin.listUsers();
  if (listError) throw new Error(`reading the user list failed: ${listError.message}`);
  const onFirstPage = new Set(firstPage.users.map((user) => user.id));
  const admin = created.find((user) => !onFirstPage.has(user.id));
  const passenger = created.find((user) => user.id !== admin?.id);
  check('more than 60 users exist and the test admin is outside the first page of the user list', admin != null);
  if (!admin) throw new Error('could not place the admin outside the first page');

  const { error: grantError } = await service.from('user_roles').insert({ user_id: admin.id, role: 'admin' });
  if (grantError) throw new Error(`granting the admin role failed: ${grantError.message}`);

  // 1. The matcher with 60+ users.
  const withAdmin = await runMatcherAsCron();
  check('the matcher runs with more than 60 users', withAdmin.status === 200 && !withAdmin.text.includes('error'), withAdmin.text);

  const { data: jobRun } = await service.from('job_runs').select('last_success_at').eq('job', 'match-and-group').maybeSingle();
  const recordedMs = jobRun?.last_success_at ? Date.now() - new Date(jobRun.last_success_at).getTime() : null;
  check('the run was recorded as successful', recordedMs != null && recordedMs < 120_000);

  // 3a. A normal user is refused.
  const asPassenger = await signIn(passenger.email);
  const { data: passengerIsAdmin } = await asPassenger.client.rpc('is_admin');
  check('a normal user does not have the admin role', passengerIsAdmin === false);

  const { data: passengerJobRuns } = await asPassenger.client.from('job_runs').select('job');
  check('a normal user cannot read the job status', (passengerJobRuns ?? []).length === 0);

  const { data: passengerEdit } = await asPassenger.client
    .from('airline_terminals')
    .update({ airline_name: 'changed by a normal user' })
    .eq('airline_iata', 'VY')
    .select('airline_iata');
  check('a normal user cannot change the airline list', (passengerEdit ?? []).length === 0);

  const passengerMatcher = await runMatcher({ Authorization: `Bearer ${asPassenger.token}` });
  check('a normal user cannot run the matcher by hand', passengerMatcher.status === 401, `status ${passengerMatcher.status}`);

  const manage = await fetch(`${url}/functions/v1/admin-manage-group`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${asPassenger.token}`, apikey: anonKey },
    body: JSON.stringify({ action: 'dissolve', groupId: randomUUID() }),
  });
  check('a normal user cannot use the admin group actions', manage.status === 401, `status ${manage.status}`);

  const { error: passengerRpcError } = await asPassenger.client.rpc('admin_dissolve_group', { p_group_id: randomUUID() });
  check('a normal user is refused by the admin database functions', passengerRpcError?.code === '42501', `code ${passengerRpcError?.code}`);

  // 3b. A user with the role is let in.
  const asAdmin = await signIn(admin.email);
  const { data: adminIsAdmin } = await asAdmin.client.rpc('is_admin');
  check('the user with the role is recognised as admin', adminIsAdmin === true);

  const { data: adminJobRuns } = await asAdmin.client.from('job_runs').select('job');
  check('the admin can read the job status', (adminJobRuns ?? []).length > 0);

  // An access rule that used to compare the email: the admin must still get through it.
  const { data: airline } = await service.from('airline_terminals').select('airline_name').eq('airline_iata', 'VY').single();
  const { data: adminEdit } = await asAdmin.client
    .from('airline_terminals')
    .update({ airline_name: airline.airline_name })
    .eq('airline_iata', 'VY')
    .select('airline_iata');
  check('the admin can change the airline list', (adminEdit ?? []).length === 1);

  // A database function that used to compare the email: past the admin check, an unknown group
  // is "not found" (P0002) rather than "not authorized" (42501).
  const { error: adminRpcError } = await asAdmin.client.rpc('admin_dissolve_group', { p_group_id: randomUUID() });
  check('the admin gets past the admin database functions', adminRpcError?.code === 'P0002', `code ${adminRpcError?.code}`);

  const adminMatcher = await runMatcher({ Authorization: `Bearer ${asAdmin.token}` });
  check('the admin can run the matcher by hand', adminMatcher.status === 200, `status ${adminMatcher.status}`);

  // 2. No admin at all.
  const { data: otherAdmins } = await service.from('user_roles').select('user_id').eq('role', 'admin').neq('user_id', admin.id);
  if ((otherAdmins ?? []).length > 0) {
    console.log(`NOTE  the test project has ${otherAdmins.length} other admin(s); they are removed for this step and restored after.`);
    await service.from('user_roles').delete().eq('role', 'admin').neq('user_id', admin.id);
  }
  await service.from('user_roles').delete().eq('user_id', admin.id);
  const { count: adminCount } = await service.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'admin');
  check('there is no admin at all', adminCount === 0);

  const withoutAdmin = await runMatcherAsCron();
  check('the matcher runs with no admin at all', withoutAdmin.status === 200 && !withoutAdmin.text.includes('error'), withoutAdmin.text);

  // What the matcher does when it forms a group: one without anybody as its creator.
  const { data: systemGroup, error: systemGroupError } = await service.from('taxi_groups').insert({}).select('id, created_by').single();
  check('a group can be formed by the system, with no account behind it', !systemGroupError && systemGroup?.created_by === null, systemGroupError?.message ?? '');
  if (systemGroup) await service.from('taxi_groups').delete().eq('id', systemGroup.id);

  const { data: revokedIsAdmin } = await asAdmin.client.rpc('is_admin');
  check('removing the role takes effect at once, without logging in again', revokedIsAdmin === false);

  if ((otherAdmins ?? []).length > 0) {
    await service.from('user_roles').insert(otherAdmins.map((row) => ({ user_id: row.user_id, role: 'admin' })));
  }
} catch (err) {
  failures += 1;
  console.error(`FAIL  ${err instanceof Error ? err.message : err}`);
} finally {
  console.log('Deleting the test users...');
  for (const user of created) {
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.warn(`could not delete ${user.email}: ${error.message}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
