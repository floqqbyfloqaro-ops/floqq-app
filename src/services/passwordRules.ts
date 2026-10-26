// The pure rules behind the "Change password" form - no imports, so a plain Node test loads this
// file directly (passwordRules.test.mjs). The server applies the same ones again
// (supabase/functions/_shared/passwordChangeRules.ts); Supabase Auth's own minimum is 8 as well.

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;

export type PasswordStrength = 'weak' | 'fair' | 'strong';

// A simple guide, not a rule: length plus the kinds of characters used.
export function passwordStrength(password: string): PasswordStrength | null {
  if (!password) return null;
  if (password.length < MIN_PASSWORD_LENGTH) return 'weak';
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((kind) => kind.test(password)).length;
  if (password.length >= 12 && kinds >= 3) return 'strong';
  if (kinds >= 2) return 'fair';
  return 'weak';
}

export type ChangePasswordForm = { current: string; next: string; confirm: string };
export type FieldError = 'too_short' | 'too_long' | 'same_as_current' | 'mismatch';

// What's wrong with the new password and its confirmation - shown once the passenger has typed
// something there.
export function newPasswordError(form: ChangePasswordForm): FieldError | null {
  if (!form.next) return null;
  if (form.next.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (form.next.length > MAX_PASSWORD_LENGTH) return 'too_long';
  if (form.current && form.next === form.current) return 'same_as_current';
  return null;
}

export function confirmError(form: ChangePasswordForm): FieldError | null {
  return form.confirm && form.confirm !== form.next ? 'mismatch' : null;
}

// "Save" is enabled only when every field is filled in and nothing is wrong.
export function canSave(form: ChangePasswordForm): boolean {
  return Boolean(form.current && form.next && form.confirm) && !newPasswordError(form) && !confirmError(form);
}
