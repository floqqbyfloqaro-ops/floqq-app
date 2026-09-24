import i18n from '../i18n';
import { supabase } from './supabase';

// Where the "Verify my email" link lands after Supabase has marked the email verified. A static
// GitHub Pages page (docs/email-verified.html) rather than a direct floqq:// link, same reasoning
// as the password-reset page: it always shows a clear confirmation, even on a laptop or in Expo
// Go where the app's custom scheme can't open. Its "Open FLOQQ" button hands the session on to
// the app via EMAIL_VERIFIED_APP_PATH. Must be in Supabase's Auth → URL Configuration allow-list.
export const EMAIL_VERIFIED_PAGE_URL = 'https://floqqbyfloqaro-ops.github.io/floqq-app/email-verified.html';

// floqq://email-verified#access_token=…&refresh_token=… - built by the page, handled in App.tsx.
export const EMAIL_VERIFIED_APP_PATH = 'email-verified';

// Supabase refuses a resend within 60 seconds of the previous email.
export const RESEND_COOLDOWN_SECONDS = 60;

// The language is stored on the account so the (single, per-project) Supabase email template can
// pick EN/ES/FR via {{ .Data.language }} - see supabase/templates/confirm-signup.html.
export function signUpWithEmail(fullName: string, email: string, password: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, language: i18n.language },
      emailRedirectTo: EMAIL_VERIFIED_PAGE_URL,
    },
  });
}

export function resendVerificationEmail(email: string) {
  return supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: EMAIL_VERIFIED_PAGE_URL },
  });
}

// Supabase's error code for a password login on an account whose email isn't verified yet.
export function isEmailNotConfirmedError(error: unknown) {
  return (error as { code?: string } | null)?.code === 'email_not_confirmed';
}

// Pulls the session tokens out of floqq://email-verified#access_token=…&refresh_token=…
// Returns null for any other link, so unrelated deep links are left alone.
export function parseEmailVerifiedLink(url: string): { accessToken: string; refreshToken: string } | null {
  const [beforeHash, hash = ''] = url.split('#');
  if (!beforeHash.includes(EMAIL_VERIFIED_APP_PATH)) return null;

  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}
