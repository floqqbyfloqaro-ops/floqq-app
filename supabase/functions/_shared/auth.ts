import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Is this user an admin? A direct lookup of their own role (user_roles) - never a search through
// the user list, so it works the same with any number of users.
export async function isAdminUser(adminClient: SupabaseClient, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await adminClient
    .from('user_roles')
    .select('user_id')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();
  if (error) console.warn('reading the admin role failed', error.message);
  return data != null;
}

// Dual auth for scheduled Edge Functions: a pg_cron-invoked request carries no user session,
// so it authenticates via a shared secret header instead; an on-demand call (admin, or curl
// for testing) carries a normal Supabase user JWT and must belong to an admin.
export async function isAuthorized(req: Request, adminClient: SupabaseClient): Promise<boolean> {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const providedCronSecret = req.headers.get('x-cron-secret');
  if (cronSecret && providedCronSecret === cronSecret) {
    return true;
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return false;
  }

  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data } = await adminClient.auth.getUser(jwt);
  return isAdminUser(adminClient, data.user?.id);
}
