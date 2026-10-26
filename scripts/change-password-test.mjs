// Checks "Change password" (supabase/functions/change-password, 20261026010000_password_change.sql)
// against the TEST Supabase project only:
//   - a successful change: the new password works, the old one doesn't, this device stays signed in
//     and the user's other device is signed out; 'password_changed' is recorded with nothing else;
//   - refused: a wrong current password, a too short new one, the same as the current one;
//   - 5 wrong current passwords: the 5th and every try after it waits 15 minutes - even with the
//     right password;
//   - an Apple or Google account has no password to change;
//   - with "require current password" on, a plain password change without it is refused, and the
//     "Forgot password?" email link (recovery) still sets a new password.
// It creates its own throwaway users and deletes them again at the end.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Run with:
//   node --env-file=.env.test.local scripts/change-password-test.mjs

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

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

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const createdUsers = [];

async function account(label, password, appMetadata = null) {
  const email = `password-test-${runId}-${label}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: label, last_name: 'Test', date_of_birth: '1990-05-05' },
    ...(appMetadata ? { app_metadata: appMetadata } : {}),
  });
  if (error) throw new Error(`creating ${label} failed: ${error.message}`);
  createdUsers.push(data.user);
  return { label, email, user: data.user };
}

// A signed-in "device": its own client and session.
async function device(email, password) {
  const client = createClient(url, anonKey, options);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signing in ${email} failed: ${error.message}`);
  return client;
}

async function changePassword(client, body) {
  const { data, error } = await client.functions.invoke('change-password', { body: { language: 'en', ...body } });
  if (!error) return { status: 200, data };
  return { status: error.context?.status ?? 0, data: await error.context?.json().catch(() => null) };
}

async function canSignIn(email, password) {
  const client = createClient(url, anonKey, options);
  const { error } = await client.auth.signInWithPassword({ email, password });
  return !error;
}

// A session still counts if it can be refreshed (signed-out sessions can't).
async function stillSignedIn(client) {
  const { data, error } = await client.auth.refreshSession();
  return !error && Boolean(data.session);
}

try {
  // --- A successful change, on one of two devices ---
  const oldPassword = `Old-${randomUUID()}`;
  const newPassword = `New-${randomUUID()}`;
  const ana = await account('ana', oldPassword);
  const phone = await device(ana.email, oldPassword);
  const tablet = await device(ana.email, oldPassword);

  const tooShort = await changePassword(phone, { currentPassword: oldPassword, newPassword: 'short7!' });
  check('a new password under 8 characters is refused', tooShort.status === 400 && tooShort.data?.error === 'too_short', JSON.stringify(tooShort.data));
  const same = await changePassword(phone, { currentPassword: oldPassword, newPassword: oldPassword });
  check('the same password as the current one is refused', same.status === 400 && same.data?.error === 'same_as_current', JSON.stringify(same.data));
  const wrong = await changePassword(phone, { currentPassword: 'not-the-password', newPassword });
  check(
    'a wrong current password is refused, with the tries left',
    wrong.status === 400 && wrong.data?.error === 'wrong_current_password' && wrong.data?.attemptsLeft === 4,
    JSON.stringify(wrong.data)
  );
  check('...and nothing changed', await canSignIn(ana.email, oldPassword));

  const done = await changePassword(phone, { currentPassword: oldPassword, newPassword, language: 'fr' });
  check('the right current password: changed', done.status === 200 && done.data?.ok === true, JSON.stringify(done.data));
  check('the new password signs in', await canSignIn(ana.email, newPassword));
  check('the old password no longer does', !(await canSignIn(ana.email, oldPassword)));
  check('this device is still signed in', await stillSignedIn(phone));
  check('the other device is signed out', !(await stillSignedIn(tablet)));

  const { data: events } = await service.from('profile_events').select('event_type, details, actor_type, created_at').eq('user_id', ana.user.id);
  const changed = (events ?? []).filter((e) => e.event_type === 'password_changed');
  check(
    "'password_changed' is recorded once, with its time and nothing else",
    changed.length === 1 && changed[0].details == null && changed[0].actor_type === 'user' && Boolean(changed[0].created_at),
    JSON.stringify(changed)
  );
  const { count: attemptsLeftOver } = await service.from('password_change_attempts').select('id', { count: 'exact', head: true }).eq('user_id', ana.user.id);
  check('the wrong try is forgotten after the change', attemptsLeftOver === 0, String(attemptsLeftOver));
  console.log(`      email sent: ${done.data?.emailSent} (the test project's Resend sender only delivers to the Resend account's own address)`);

  // --- 5 wrong tries: wait 15 minutes ---
  const benPassword = `Ben-${randomUUID()}`;
  const ben = await account('ben', benPassword);
  const benPhone = await device(ben.email, benPassword);
  const answers = [];
  for (let i = 0; i < 5; i += 1) {
    answers.push(await changePassword(benPhone, { currentPassword: `wrong-${i}`, newPassword: `Ben-new-${randomUUID()}` }));
  }
  check(
    'tries 1 to 4 say how many are left',
    answers.slice(0, 4).every((a, i) => a.data?.error === 'wrong_current_password' && a.data?.attemptsLeft === 4 - i),
    JSON.stringify(answers.slice(0, 4).map((a) => a.data?.attemptsLeft))
  );
  const retryAt = Date.parse(answers[4].data?.retryAt ?? '');
  check(
    'the 5th wrong try: locked for 15 minutes',
    answers[4].status === 429 && answers[4].data?.error === 'locked' && Math.abs(retryAt - (Date.now() + 15 * 60_000)) < 60_000,
    JSON.stringify(answers[4].data)
  );
  const lockedRight = await changePassword(benPhone, { currentPassword: benPassword, newPassword: `Ben-new-${randomUUID()}` });
  check('while locked, even the right password waits', lockedRight.status === 429 && lockedRight.data?.error === 'locked', JSON.stringify(lockedRight.data));
  check("...and the password didn't change", await canSignIn(ben.email, benPassword));

  // --- Apple / Google: no password ---
  const googlePassword = `Google-${randomUUID()}`;
  const gil = await account('gil', googlePassword, { provider: 'google', providers: ['google'] });
  const gilPhone = await device(gil.email, googlePassword);
  const google = await changePassword(gilPhone, { currentPassword: googlePassword, newPassword: `Gil-new-${randomUUID()}` });
  check('a Google account has no password to change', google.status === 403 && google.data?.error === 'no_password', JSON.stringify(google.data));

  // --- Auth itself: no change without the current password; the reset link still works ---
  const caraPassword = `Cara-${randomUUID()}`;
  const cara = await account('cara', caraPassword);
  const caraPhone = await device(cara.email, caraPassword);
  const { error: plainError } = await caraPhone.auth.updateUser({ password: `Cara-new-${randomUUID()}` });
  check('Auth refuses a password change without the current password', Boolean(plainError), plainError?.code ?? plainError?.message ?? 'no error');
  check("...so Cara's password is unchanged", await canSignIn(cara.email, caraPassword));

  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: 'recovery', email: cara.email });
  if (linkError) throw new Error(`generating a recovery link failed: ${linkError.message}`);
  const recovering = createClient(url, anonKey, options);
  const { error: verifyError } = await recovering.auth.verifyOtp({ type: 'recovery', token_hash: link.properties.hashed_token });
  const resetPassword = `Cara-reset-${randomUUID()}`;
  const { error: resetError } = verifyError ? { error: verifyError } : await recovering.auth.updateUser({ password: resetPassword });
  check('"Forgot password?" (the email link) still sets a new password', !resetError, resetError?.code ?? resetError?.message ?? '');
  check('...and it signs in', !resetError && (await canSignIn(cara.email, resetPassword)));
} catch (err) {
  failures += 1;
  console.error('FAIL  the run stopped:', err.message);
} finally {
  console.log('Deleting the test users...');
  for (const user of createdUsers) {
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.error(`deleting ${user.email} failed: ${error.message}`);
  }
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
