// "End chat", "Close request" and follow-up chips (20261028000000_help_end_chat.sql, help-chat),
// against the TEST Supabase project and the real model - a few cents per run:
//   - End chat -> a closing message, archived "Closed by you", read-only, never reopened, "Was this
//     helpful?" allowed; a new message starts a new conversation;
//   - End chat with a call back waiting -> "Keep it open" keeps the ticket; "Cancel it" closes it
//     (resolved, 'closed_by_user', a 'closed_by_user' event) - the admin sees "Closed by user";
//   - Close request from "Your requests" for a call back within 2 hours -> closed, the team alerted
//     by email; one 3 hours away -> closed, no alert;
//   - follow-up chips: after the fee, valid suggestions; after a cancellation, "Book a new ride";
//     in French and Spanish the follow-ups are topic names too.
// It sets the test project's alert address for a moment (and puts it back), creates its own
// throwaway users, rides and tickets, and deletes them again at the end.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Run with:
//   node --env-file=.env.test.local scripts/help-end-chat-test.mjs

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const LIVE_PROJECT_REF = 'notpvjikdbbelrdgplkc';
// The alert goes here during the test: the Resend account's own address (the test project's sender
// only delivers there).
const ALERT_TO = 'floqqbyfloqaro@gmail.com';

const url = process.env.TEST_SUPABASE_URL;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const missing = ['TEST_SUPABASE_URL', 'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing in .env.test.local: ${missing.join(', ')}`);
  process.exit(2);
}
if (url.includes(LIVE_PROJECT_REF)) {
  console.error('TEST_SUPABASE_URL points at the LIVE project. This script only runs against the test project.');
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceRoleKey, options);
const runId = randomUUID().slice(0, 8);
const password = `Test-${randomUUID()}`;
const HOUR = 60 * 60_000;
const TOPICS = [
  'cancel', 'change_ride', 'why_no_match', 'how_matching', 'flight_delayed', 'meeting_point', 'find_group', 'arrow', 'someone_missing',
  'cost', 'who_pays', 'fare_split', 'refund', 'payment_failed', 'change_password', 'no_email', 'change_email', 'how_it_works', 'is_it_safe', 'book_new_ride',
];

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const createdUsers = [];

async function person(label, ride) {
  const email = `endchat-${runId}-${label}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: label, last_name: 'Test', date_of_birth: '1990-05-05' },
  });
  if (error) throw new Error(`creating ${label} failed: ${error.message}`);
  createdUsers.push(data.user);
  await service.from('profiles').upsert({ user_id: data.user.id, first_name: label, last_name: 'Test' });
  let rideId = null;
  if (ride) {
    const { data: row } = await service
      .from('passenger_requests')
      .insert({
        user_id: data.user.id, passenger_name: `${label} Test`, flight_number: 'VY1803',
        arrival_at: new Date(Date.now() + ride.hoursAhead * HOUR).toISOString(), arrival_time_source: 'manual',
        arrival_terminal: 'T1', arrival_terminal_source: 'passenger', destination_address: 'Carrer de Mallorca 200, Eixample, Barcelona',
        destination_lat: 41.392, destination_lng: 2.158, large_luggage_count: 0, hand_luggage_count: 1, max_wait_minutes: 15, distance_km: 8,
      })
      .select('id')
      .single();
    rideId = row.id;
  }
  const client = createClient(url, anonKey, options);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signing in ${label} failed: ${signInError.message}`);
  return { label, user: data.user, rideId, client };
}

async function call(client, body) {
  const { data, error } = await client.functions.invoke('help-chat', { body });
  if (!error) return { status: 200, data };
  return { status: error.context?.status ?? 0, data: await error.context?.json().catch(() => null) };
}

const start = async (who, language, extra = {}) => (await call(who.client, { action: 'start', language, fresh: true, ...extra })).data.conversationId;
const say = async (who, conversationId, message, language) => {
  const answer = await call(who.client, { action: 'send', conversationId, message, language });
  console.log(`  [${who.label} ${language}] ${message}\n      > ${(answer.data?.message?.content ?? '').replace(/\n/g, ' ')}\n      follow-ups: ${JSON.stringify(answer.data?.message?.followup_topics ?? null)}`);
  return answer;
};
const conversationState = async (id) => (await service.from('help_conversations').select('state').eq('id', id).single()).data?.state;

// A waiting call back on this conversation, inserted as support-handover would.
async function callbackTicket(who, conversationId, hoursAhead) {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const reference = Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  const { data, error } = await service
    .from('support_tickets')
    .insert({
      reference, user_id: who.user.id, conversation_id: conversationId, category: 'user_asked', language: 'en', channel: 'callback',
      callback_phone: '+34612345678', callback_at: new Date(Date.now() + hoursAhead * HOUR).toISOString(), callback_consent_at: new Date().toISOString(),
    })
    .select('id, reference')
    .single();
  if (error) throw new Error(`creating the ticket failed: ${error.message}`);
  await service.from('help_conversations').update({ handed_over_at: new Date().toISOString(), handover_reason: 'user_asked' }).eq('id', conversationId);
  return data;
}
const ticketRow = async (id) => (await service.from('support_tickets').select('status, resolution_category').eq('id', id).single()).data;

const { data: savedSettings } = await service.from('support_settings').select('alert_email').eq('id', 1).single();

try {
  await service.from('support_settings').update({ alert_email: ALERT_TO }).eq('id', 1);

  // --- End chat, in three languages ---
  for (const language of ['en', 'fr', 'es']) {
    const who = await person(`End${language}`);
    const id = await start(who, language);
    await say(who, id, { en: 'How does FLOQQ work?', fr: 'Comment marche FLOQQ ?', es: '¿Cómo funciona FLOQQ?' }[language], language);
    const ended = await call(who.client, { action: 'end', conversationId: id, cancelTicket: false, language });
    check(
      `${language}: End chat -> a closing message, archived "Closed by you"`,
      ended.status === 200 && ended.data?.conversation?.state === 'closed_by_user' && (ended.data?.message?.content ?? '').length > 0,
      ended.data?.message?.content
    );
    const after = await call(who.client, { action: 'send', conversationId: id, message: 'one more thing', language });
    check(`${language}: ...read-only straight away (never reopened)`, after.status === 409 && after.data?.error === 'conversation_closed', String(after.status));
    const rated = await call(who.client, { action: 'rate', conversationId: id, value: 'up' });
    check(`${language}: ..."Was this helpful?" allowed`, rated.status === 200, String(rated.status));
    const back = await call(who.client, { action: 'start', language });
    check(`${language}: ...coming back starts a new conversation`, back.data?.conversationId && back.data.conversationId !== id && back.data.messages.length === 0);
  }

  // --- End chat with a call back waiting ---
  const kai = await person('Kai');
  const keepId = await start(kai, 'en');
  await say(kai, keepId, 'How long does matching take?', 'en');
  const kept = await callbackTicket(kai, keepId, 1);
  await call(kai.client, { action: 'end', conversationId: keepId, cancelTicket: false, language: 'en' });
  const keptRow = await ticketRow(kept.id);
  check('End chat + "Keep it open" -> the chat is archived, the ticket still waits', (await conversationState(keepId)) === 'closed_by_user' && keptRow.status === 'open', `${keptRow.status}`);

  const lia = await person('Lia');
  const cancelId = await start(lia, 'en');
  await say(lia, cancelId, 'When do I pay?', 'en');
  const cancelled = await callbackTicket(lia, cancelId, 1);
  const cancelEnd = await call(lia.client, { action: 'end', conversationId: cancelId, cancelTicket: true, language: 'en' });
  const cancelledRow = await ticketRow(cancelled.id);
  const { data: cancelEvents } = await service.from('support_ticket_events').select('kind').eq('ticket_id', cancelled.id);
  check(
    'End chat + "Cancel it" -> the ticket is closed by the user (call back off), the admin sees it, the team alerted',
    cancelledRow.status === 'resolved' && cancelledRow.resolution_category === 'closed_by_user' && cancelEvents?.some((e) => e.kind === 'closed_by_user') && cancelEnd.data?.ticketClosed === true && cancelEnd.data?.teamAlerted === true,
    JSON.stringify({ ...cancelledRow, alerted: cancelEnd.data?.teamAlerted })
  );
  const { data: liaTickets } = await lia.client.from('support_tickets').select('status, resolution_category').eq('id', cancelled.id);
  check('...and Lia sees it as closed by her', liaTickets?.[0]?.resolution_category === 'closed_by_user');

  // --- Close request from "Your requests" ---
  const max = await person('Max');
  const laterId = await start(max, 'en');
  await say(max, laterId, 'Is it safe?', 'en');
  const later = await callbackTicket(max, laterId, 3);
  const closedLater = await call(max.client, { action: 'end', conversationId: laterId, cancelTicket: true, language: 'en' });
  check(
    'Close request, call back 3 hours away -> closed, no alert needed',
    (await ticketRow(later.id)).resolution_category === 'closed_by_user' && closedLater.data?.teamAlerted === false,
    `alerted ${closedLater.data?.teamAlerted}`
  );
  const other = await call(lia.client, { action: 'end', conversationId: laterId, cancelTicket: true, language: 'en' });
  check("nobody closes someone else's request", other.status === 404, String(other.status));

  // --- Follow-up chips ---
  for (const [language, question] of [['en', 'How much is the FLOQQ fee?'], ['fr', 'Combien coûtent les frais FLOQQ ?'], ['es', '¿Cuánto cuesta la tarifa de FLOQQ?']]) {
    const who = await person(`Chips${language}`);
    const id = await start(who, language);
    const fee = await say(who, id, question, language);
    const topics = fee.data?.message?.followup_topics ?? [];
    check(
      `${language}: after the fee -> 1 to 3 follow-up chips from the list (not the fee again)`,
      topics.length >= 1 && topics.length <= 3 && topics.every((topic) => TOPICS.includes(topic)) && !topics.includes('cost'),
      JSON.stringify(topics)
    );
  }
  const nina = await person('Nina', { hoursAhead: 30 });
  const ninaId = await start(nina, 'en');
  const asked = await say(nina, ninaId, 'Cancel my ride please', 'en');
  const card = (asked.data?.message?.cards ?? []).find((c) => c.type === 'confirm_cancel');
  const done = await call(nina.client, { action: 'decide', actionId: card?.actionId, decision: 'confirm', language: 'en' });
  check('after a cancellation -> "Book a new ride"', JSON.stringify(done.data?.message?.followup_topics) === '["book_new_ride"]', JSON.stringify(done.data?.message?.followup_topics));
} catch (err) {
  failures += 1;
  console.error(`FAIL  ${err instanceof Error ? err.stack : err}`);
} finally {
  console.log('Putting the alert address back and deleting the test data...');
  await service.from('support_settings').update(savedSettings).eq('id', 1);
  for (const user of createdUsers) {
    await service.from('support_tickets').delete().eq('user_id', user.id);
    await service.from('help_conversations').delete().eq('user_id', user.id);
    const { data: rides } = await service.from('passenger_requests').select('id').eq('user_id', user.id);
    if (rides?.length) await service.from('group_events').delete().in('request_id', rides.map((r) => r.id));
    await service.from('passenger_requests').delete().eq('user_id', user.id);
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.warn(`could not delete ${user.email}: ${error.message}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
