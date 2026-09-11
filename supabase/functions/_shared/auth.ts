import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Dual auth for scheduled Edge Functions: a pg_cron-invoked request carries no user session,
// so it authenticates via a shared secret header instead; an on-demand call (admin, or curl
// for testing) carries a normal Supabase user JWT and must belong to the admin account.
export async function isAuthorized(
  req: Request,
  adminClient: SupabaseClient,
  adminEmail: string
): Promise<boolean> {
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
  return data.user?.email === adminEmail;
}
