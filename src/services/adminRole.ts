import { supabase } from './supabase';

// Whether the logged-in user has the admin role (user_roles, checked by the is_admin() database
// function for this user alone). False when it can't be read: the admin screens stay hidden.
export async function fetchIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) {
    console.warn('is_admin failed', error.message);
    return false;
  }
  return data === true;
}
