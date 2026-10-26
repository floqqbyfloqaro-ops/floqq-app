// The pure rules behind "Change password" (supabase/functions/change-password) - no imports, so a
// plain Node test loads this file directly (passwordChangeRules.test.ts). Passwords only ever pass
// through these functions; nothing here stores or logs them.

// Matches the Supabase Auth minimum (password_min_length) on both projects.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;

// 5 wrong current passwords within 15 minutes: no more tries until 15 minutes after the 5th.
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
const MINUTE_MS = 60_000;

export type PasswordProblem = 'too_short' | 'too_long' | 'same_as_current';

export function newPasswordProblem(currentPassword: string, newPassword: string): PasswordProblem | null {
  if (newPassword.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (newPassword.length > MAX_PASSWORD_LENGTH) return 'too_long';
  if (newPassword === currentPassword) return 'same_as_current';
  return null;
}

// How far back the failed attempts must be read: 15 minutes for the 5 tries, plus the 15-minute
// wait that may still be running after them.
export const ATTEMPTS_LOOKBACK_MS = 2 * LOCKOUT_MINUTES * MINUTE_MS;

// The failed attempts (their times, ms; at least the last ATTEMPTS_LOOKBACK_MS) -> until when the
// user must wait, or null when they may try. 5 within 15 minutes lock for 15 minutes from the 5th,
// even once the earlier ones are more than 15 minutes old.
export function lockedUntil(failedAtMs: number[], nowMs: number): number | null {
  const sorted = [...failedAtMs].sort((a, b) => a - b);
  let until: number | null = null;
  for (let i = MAX_FAILED_ATTEMPTS - 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - MAX_FAILED_ATTEMPTS + 1] <= LOCKOUT_MINUTES * MINUTE_MS) {
      until = sorted[i] + LOCKOUT_MINUTES * MINUTE_MS;
    }
  }
  return until != null && until > nowMs ? until : null;
}

// Tries left before the wait: the wrong ones in the last 15 minutes count.
export function attemptsLeft(failedAtMs: number[], nowMs: number): number {
  const recent = failedAtMs.filter((at) => at > nowMs - LOCKOUT_MINUTES * MINUTE_MS).length;
  return Math.max(0, MAX_FAILED_ATTEMPTS - recent);
}

// --- The "your password was changed" email, in the phone's language ---

export const EMAIL_LANGUAGES = ['en', 'fr', 'es', 'it', 'nl'] as const;
export type EmailLanguage = (typeof EMAIL_LANGUAGES)[number];

// "fr-BE", "FR", "nl" ... -> one of the email languages; anything else -> English.
export function emailLanguageFor(value: unknown): EmailLanguage {
  const code = typeof value === 'string' ? value.slice(0, 2).toLowerCase() : '';
  return (EMAIL_LANGUAGES as readonly string[]).includes(code) ? (code as EmailLanguage) : 'en';
}

export const SUPPORT_EMAIL = 'floqqbyfloqaro@gmail.com';

// The button names are the app's own (src/i18n/locales): the app is in English, French and Spanish,
// so an Italian or Dutch phone shows it in English - those emails name the English buttons.
const EMAIL_TEXT: Record<EmailLanguage, { subject: string; body: string }> = {
  en: {
    subject: 'Your FLOQQ password was changed',
    body:
      'Your FLOQQ password was changed.\n\n' +
      'If this wasn\'t you, contact us at {support} right away and reset your password: open FLOQQ and tap "Forgot password?" on the Sign In screen.',
  },
  fr: {
    subject: 'Votre mot de passe FLOQQ a été modifié',
    body:
      'Votre mot de passe FLOQQ a été modifié.\n\n' +
      "Si ce n'était pas vous, contactez-nous immédiatement à {support} et réinitialisez votre mot de passe : ouvrez FLOQQ et touchez « Mot de passe oublié ? » sur l'écran Se connecter.",
  },
  es: {
    subject: 'Se ha cambiado tu contraseña de FLOQQ',
    body:
      'Se ha cambiado tu contraseña de FLOQQ.\n\n' +
      'Si no has sido tú, escríbenos enseguida a {support} y restablece tu contraseña: abre FLOQQ y toca «¿Olvidaste tu contraseña?» en la pantalla Iniciar sesión.',
  },
  it: {
    subject: 'La tua password FLOQQ è stata modificata',
    body:
      'La tua password FLOQQ è stata modificata.\n\n' +
      'Se non sei stato tu, contattaci subito a {support} e reimposta la password: apri FLOQQ e tocca "Forgot password?" nella schermata "Sign In".',
  },
  nl: {
    subject: 'Je FLOQQ-wachtwoord is gewijzigd',
    body:
      'Je FLOQQ-wachtwoord is gewijzigd.\n\n' +
      'Was jij dit niet? Neem dan meteen contact met ons op via {support} en stel je wachtwoord opnieuw in: open FLOQQ en tik op "Forgot password?" op het scherm "Sign In".',
  },
};

export function passwordChangedEmail(language: EmailLanguage): { subject: string; text: string } {
  const { subject, body } = EMAIL_TEXT[language];
  return { subject, text: body.replace('{support}', SUPPORT_EMAIL) };
}
