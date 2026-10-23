// Sends one real new-ticket alert email from the TEST Supabase project, to check the Resend setup
// (RESEND_API_KEY secret, support_settings.alert_email). Creates a throwaway passenger, a short
// help conversation and a call-back ticket, reports whether the email went out, and deletes the
// passenger again. Costs a fraction of a cent (the ticket summary).
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Run with:
//   node --env-file=.env.test.local scripts/support-alert-test.mjs

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const LIVE_PROJECT_REF = 'notpvjikdbbelrdgplkc';

const url = process.env.TEST_SUPABASE_URL;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceRoleKey) {
  console.error('Missing TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY / TEST_SUPABASE_SERVICE_ROLE_KEY in .env.test.local.');
  process.exit(2);
}
if (url.includes(LIVE_PROJECT_REF)) {
  console.error('TEST_SUPABASE_URL points at the LIVE project. This script only runs against the test project.');
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceRoleKey, options);
const email = `alert-test-${randomUUID().slice(0, 8)}@example.com`;
const password = `Test-${randomUUID()}`;

const { data: created, error } = await service.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { first_name: 'Alert', last_name: 'Test', date_of_birth: '1990-05-05' },
});
if (error) throw error;
let exitCode = 1;
try {
  const client = createClient(url, anonKey, options);
  await client.auth.signInWithPassword({ email, password });
  const invoke = async (name, body) => {
    const { data, error: invokeError } = await client.functions.invoke(name, { body });
    if (invokeError) throw new Error(`${name}: ${JSON.stringify(await invokeError.context?.json().catch(() => null))}`);
    return data;
  };
  const { conversationId } = await invoke('help-chat', { action: 'start', language: 'en' });
  await invoke('help-chat', {
    action: 'send',
    conversationId,
    message: 'This is a test of the FLOQQ support alert email. Please ignore it.',
    language: 'en',
  });
  const ticket = await invoke('support-handover', {
    action: 'create',
    conversationId,
    reason: 'user_asked',
    language: 'en',
    channel: 'callback',
    phone: '+34612345678',
    callbackAt: null,
    consent: true,
  });
  console.log(`Ticket #${ticket.reference} created. Alert email sent: ${ticket.alertSent ? 'yes' : 'NO'}`);
  exitCode = ticket.alertSent ? 0 : 1;
} finally {
  await service.from('support_tickets').delete().eq('user_id', created.user.id);
  await service.from('help_conversations').delete().eq('user_id', created.user.id);
  await service.auth.admin.deleteUser(created.user.id);
}
process.exit(exitCode);
