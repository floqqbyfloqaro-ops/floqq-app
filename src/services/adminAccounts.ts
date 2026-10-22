import { supabase } from './supabase';

// Admin only (the functions check is_admin()): accounts and their date of birth.

export type FlaggedAccount = {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  under_age_at: string;
  // Not 18 yet today (a flag stays after the birthday, for the record).
  still_under_age: boolean;
};

export type FoundAccount = {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  under_age_at: string | null;
  provider: string;
};

export type ProfileEvent = {
  id: string;
  event_type: 'date_of_birth_set' | 'date_of_birth_corrected' | string;
  details: { from?: string | null; to?: string; note?: string | null; under_age?: boolean } | null;
  actor_type: 'user' | 'admin' | 'system';
  created_at: string;
};

// Accounts that entered a date of birth under 18, newest first.
export async function fetchUnderAgeAccounts() {
  const { data, error } = await supabase.rpc('admin_under_age_accounts');
  return { data: (data ?? []) as FlaggedAccount[], error };
}

export async function findAccountByEmail(email: string) {
  const { data, error } = await supabase.rpc('admin_find_account', { p_email: email.trim() });
  return { account: ((data ?? []) as FoundAccount[])[0] ?? null, error };
}

export function fetchProfileEvents(userId: string) {
  return supabase
    .from('profile_events')
    .select('id, event_type, details, actor_type, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)
    .returns<ProfileEvent[]>();
}

// The only way to change a date of birth once set; recorded with the note.
export function correctDateOfBirth(userId: string, isoDate: string, note: string) {
  return supabase.rpc('admin_set_date_of_birth', { p_user_id: userId, p_date_of_birth: isoDate, p_note: note });
}
