import i18n from '../i18n';
import { SignInProvider, signInProviderFrom } from './profileRules';
import { supabase } from './supabase';

// Where the links in the "Confirm your new email" emails land: a static GitHub Pages page
// (docs/email-changed.html), like the sign-up one. Must be in Supabase's Auth → URL
// Configuration allow-list.
export const EMAIL_CHANGED_PAGE_URL = 'https://floqqbyfloqaro-ops.github.io/floqq-app/email-changed.html';

export type MyProfile = {
  firstName: string;
  lastName: string;
  // 'YYYY-MM-DD'; null until it has been entered.
  dateOfBirth: string | null;
  underAgeAt: string | null;
};

export type MyAccount = {
  email: string;
  // The address being changed to, while it waits for confirmation; null otherwise.
  pendingEmail: string | null;
  provider: SignInProvider;
};

// The passenger's own profile (row level security: nobody else's).
export async function fetchMyProfile() {
  const { data, error } = await supabase
    .from('profiles')
    .select('first_name, last_name, date_of_birth, under_age_at')
    .maybeSingle();
  const profile: MyProfile | null = data
    ? {
        firstName: data.first_name,
        lastName: data.last_name,
        dateOfBirth: data.date_of_birth,
        underAgeAt: data.under_age_at,
      }
    : null;
  return { profile, error };
}

// The account as the server has it now - not the session's copy, which doesn't know yet about an
// email change confirmed in a browser a moment ago.
export async function fetchMyAccount() {
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  const account: MyAccount | null = user
    ? { email: user.email ?? '', pendingEmail: user.new_email || null, provider: signInProviderFrom(user.app_metadata) }
    : null;
  return { account, error };
}

export type NameError = 'invalid_first_name' | 'invalid_last_name' | 'failed';

export async function updateMyName(firstName: string, lastName: string): Promise<{ error: NameError | null }> {
  const { error } = await supabase.rpc('update_my_name', { p_first_name: firstName, p_last_name: lastName });
  if (!error) return { error: null };
  if (error.message === 'invalid_first_name' || error.message === 'invalid_last_name') return { error: error.message };
  console.warn('update_my_name failed', error);
  return { error: 'failed' };
}

export type DateOfBirthResult = { status: 'saved' | 'under_age' | null; error: 'locked' | 'invalid' | 'failed' | null };

// Once per account: the server keeps it, checks the age, and flags an under-18 date.
export async function setMyDateOfBirth(isoDate: string): Promise<DateOfBirthResult> {
  const { data, error } = await supabase.rpc('set_my_date_of_birth', { p_date_of_birth: isoDate });
  if (!error) return { status: (data as { status: 'saved' | 'under_age' }).status, error: null };
  if (error.message === 'date_of_birth_locked') return { status: null, error: 'locked' };
  if (error.message === 'invalid_date_of_birth') return { status: null, error: 'invalid' };
  console.warn('set_my_date_of_birth failed', error);
  return { status: null, error: 'failed' };
}

export type EmailChangeError = 'email_exists' | 'invalid' | 'rate_limited' | 'failed';

function emailChangeError(error: { code?: string; status?: number; message: string }): EmailChangeError {
  const code = error.code ?? '';
  if (code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message)) return 'email_exists';
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'invalid';
  if (code.startsWith('over_') || error.status === 429) return 'rate_limited';
  console.warn('email change failed', error);
  return 'failed';
}

// Supabase's secure email change: confirmation links go out, and the new address only takes over
// once they are followed. The old one keeps working until then. The language travels with the
// account, for the email template.
export async function requestEmailChange(newEmail: string): Promise<{ error: EmailChangeError | null }> {
  const { error } = await supabase.auth.updateUser(
    { email: newEmail.trim(), data: { language: i18n.language } },
    { emailRedirectTo: EMAIL_CHANGED_PAGE_URL }
  );
  return { error: error ? emailChangeError(error) : null };
}

export async function resendEmailChange(pendingEmail: string): Promise<{ error: EmailChangeError | null }> {
  const { error } = await supabase.auth.resend({
    type: 'email_change',
    email: pendingEmail,
    options: { emailRedirectTo: EMAIL_CHANGED_PAGE_URL },
  });
  return { error: error ? emailChangeError(error) : null };
}

export async function cancelEmailChange() {
  const { error } = await supabase.rpc('cancel_my_email_change');
  if (error) console.warn('cancel_my_email_change failed', error);
  return { error };
}
