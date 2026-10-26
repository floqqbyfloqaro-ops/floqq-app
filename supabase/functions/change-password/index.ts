// "Change password" in Profile (src/screens/ChangePasswordScreen.tsx):
//   { currentPassword, newPassword, language }
//     -> { ok: true, emailSent }                     the password is changed;
//     -> { error: 'wrong_current_password', attemptsLeft }
//     -> { error: 'locked', retryAt }                5 wrong tries in 15 minutes: wait 15 minutes;
//     -> { error: 'too_short' | 'too_long' | 'same_as_current' | 'no_password' | 'failed' }.
//
// The current password is checked by Supabase Auth itself: the change goes through the user's own
// session (PUT /auth/v1/user with current_password), and the projects have "require current
// password" switched on (security_update_password_require_current_password), so Auth refuses it
// when the current password is wrong. After a change, every OTHER session of the user is signed
// out (this phone stays signed in), 'password_changed' is recorded in profile_events, and the
// user gets an email in their phone's language (_shared/passwordChangeRules.ts).
//
// Passwords are never logged or stored: nothing here prints the request body or Auth's answer,
// and password_change_attempts holds only the time of each wrong try.
//
// Deployed with the default JWT verification (any logged-in app user may call this).

import { createClient } from 'npm:@supabase/supabase-js@2';

import { sendEmail } from '../_shared/email.ts';
import {
  ATTEMPTS_LOOKBACK_MS,
  attemptsLeft,
  emailLanguageFor,
  lockedUntil,
  newPasswordProblem,
  passwordChangedEmail,
} from '../_shared/passwordChangeRules.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Auth's answers that mean "the current password is wrong" (current_password_invalid is what it
// sends today; the others are kept in case its wording changes).
const WRONG_CURRENT_CODES = ['current_password_invalid', 'current_password_mismatch', 'invalid_credentials', 'current_password_required'];

// Signed in with Apple or Google: there is no FLOQQ password (same rule as profileRules.ts).
function hasPassword(appMetadata: { provider?: unknown; providers?: unknown } | undefined): boolean {
  const listed = Array.isArray(appMetadata?.providers) ? appMetadata.providers : [];
  const providers = [appMetadata?.provider, ...listed];
  return !providers.includes('apple') && !providers.includes('google');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);
  const jwt = authHeader.replace(/^Bearer\s+/i, '');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  const language = emailLanguageFor(body.language);
  if (!currentPassword) return jsonResponse({ error: 'wrong_current_password' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: userData } = await admin.auth.getUser(jwt);
  const user = userData.user;
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!hasPassword(user.app_metadata)) return jsonResponse({ error: 'no_password' }, 403);

  const problem = newPasswordProblem(currentPassword, newPassword);
  if (problem) return jsonResponse({ error: problem }, 400);

  // Too many wrong tries lately?
  const now = Date.now();
  const since = new Date(now - ATTEMPTS_LOOKBACK_MS).toISOString();
  const { data: recent } = await admin
    .from('password_change_attempts')
    .select('failed_at')
    .eq('user_id', user.id)
    .gt('failed_at', since);
  const failedAt = (recent ?? []).map((row) => Date.parse(row.failed_at));
  const lockedAt = lockedUntil(failedAt, now);
  if (lockedAt) return jsonResponse({ error: 'locked', retryAt: new Date(lockedAt).toISOString() }, 429);

  // The change itself, through the user's own session: Auth checks the current password.
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: newPassword, current_password: currentPassword }),
  });
  if (!response.ok) {
    const answer = await response.json().catch(() => ({}));
    const code = typeof answer?.error_code === 'string' ? answer.error_code : typeof answer?.code === 'string' ? answer.code : '';
    if (WRONG_CURRENT_CODES.includes(code)) {
      await admin.from('password_change_attempts').insert({ user_id: user.id });
      const failures = [...failedAt, now];
      const nowLocked = lockedUntil(failures, now);
      if (nowLocked) return jsonResponse({ error: 'locked', retryAt: new Date(nowLocked).toISOString() }, 429);
      return jsonResponse({ error: 'wrong_current_password', attemptsLeft: attemptsLeft(failures, now) }, 400);
    }
    if (code === 'same_password') return jsonResponse({ error: 'same_as_current' }, 400);
    if (code === 'weak_password') return jsonResponse({ error: 'too_short' }, 400);
    // The status and Auth's error code only - never the body, which echoes nothing secret but
    // isn't needed.
    console.error(`password change refused by Auth: ${response.status} ${code}`);
    return jsonResponse({ error: 'failed' }, 502);
  }

  // Sign out every other device; this one keeps its session.
  const { error: signOutError } = await admin.auth.admin.signOut(jwt, 'others');
  if (signOutError) console.error('signing out the other sessions failed', signOutError.message);

  await Promise.all([
    admin.from('profile_events').insert({ user_id: user.id, event_type: 'password_changed', actor_type: 'user', actor_id: user.id }),
    admin.from('password_change_attempts').delete().eq('user_id', user.id),
  ]);

  const emailSent = user.email ? await sendEmail({ to: user.email, ...passwordChangedEmail(language) }) : false;
  return jsonResponse({ ok: true, emailSent });
});
