// Checks, against the TEST Supabase project only, the admin's support inbox (support-admin,
// 20261023050000_support_inbox.sql) and what the passenger sees of it:
//   - the inbox lists urgent tickets first, then the oldest; filters by status, channel, language;
//   - only an admin can act on tickets or read their history; notes stay with the team;
//   - call back: "No answer" (passenger notified, back in their help chat), a reply puts the
//     ticket back to open, they can then choose WhatsApp instead (number removed);
//     "Call again later" plans the next call; "Called - resolved" closes it with a category;
//   - WhatsApp tickets: no call actions, "Resolve" with a category;
//   - the admin sees the ride the ticket is about.
// It changes the test project's WhatsApp and alert settings for a moment (no alert emails for test
// tickets; both put back at the end), creates its own
// throwaway users and rides, and deletes them again at the end. A few model calls: about a cent.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Run with:
//   node --env-file=.env.test.local scripts/support-inbox-test.mjs

import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const LIVE_PROJECT_REF = 'notpvjikdbbelrdgplkc';

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

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const createdUsers = [];
const createdGroups = [];

async function person(label, rideHoursAhead = null) {
  const email = `inbox-test-${runId}-${label}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: label, last_name: 'Test', date_of_birth: '1990-05-05' },
  });
  if (error) throw new Error(`creating ${label} failed: ${error.message}`);
  createdUsers.push(data.user);
  let rideId = null;
  if (rideHoursAhead != null) {
    const { data: ride, error: rideError } = await service
      .from('passenger_requests')
      .insert({
        user_id: data.user.id,
        passenger_name: `${label} Test`,
        flight_number: 'VY1803',
        arrival_at: new Date(Date.now() + rideHoursAhead * HOUR).toISOString(),
        arrival_time_source: 'manual',
        arrival_terminal: 'T1',
        arrival_terminal_source: 'passenger',
        destination_address: 'Barcelona',
        destination_lat: 41.387,
        destination_lng: 2.17,
        large_luggage_count: 0,
        hand_luggage_count: 1,
        max_wait_minutes: 15,
        distance_km: 8,
      })
      .select('id')
      .single();
    if (rideError) throw new Error(`creating ${label}'s ride failed: ${rideError.message}`);
    rideId = ride.id;
  }
  const client = createClient(url, anonKey, options);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signing in ${label} failed: ${signInError.message}`);
  return { label, user: data.user, rideId, client };
}

async function call(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body });
  if (!error) return { status: 200, data };
  return { status: error.context?.status ?? 0, data: await error.context?.json().catch(() => null) };
}

// A passenger opens Help and asks for a person.
async function ticketFor(who, request) {
  const start = await call(who.client, 'help-chat', { action: 'start', language: 'en' });
  const conversationId = start.data.conversationId;
  const created = await call(who.client, 'support-handover', { action: 'create', conversationId, reason: 'user_asked', language: 'en', ...request });
  if (created.status !== 200) throw new Error(`ticket for ${who.label}: ${JSON.stringify(created.data)}`);
  const { data } = await service.from('support_tickets').select('*').eq('reference', created.data.reference).single();
  return { ...data, conversationId };
}

const ticketRow = async (id) => (await service.from('support_tickets').select('*').eq('id', id).single()).data;
const act = (who, ticketId, body) => call(who.client, 'support-admin', { ticketId, ...body });
const callback = { channel: 'callback', phone: '+34612345678', callbackAt: null, consent: true };

const { data: savedSettings } = await service.from('support_settings').select('whatsapp_number, alert_email').eq('id', 1).single();

try {
  // No alert emails for test tickets.
  await service.from('support_settings').update({ whatsapp_number: '+34600000000', alert_email: null }).eq('id', 1);

  const admin = await person('Ada');
  await service.from('user_roles').insert({ user_id: admin.user.id, role: 'admin' });

  // Older, not urgent: WhatsApp, French.
  const wren = await person('Wren', 40);
  const whatsappTicket = await ticketFor(wren, { channel: 'whatsapp', language: 'fr' });
  // Newer, but at the airport: call back.
  const uma = await person('Uma', 1);
  const vic = await person('Vic', 1);
  const { data: group } = await service
    .from('taxi_groups')
    .insert({ status: 'confirmed', total_fare: 40, meeting_time: new Date(Date.now() + HOUR).toISOString() })
    .select('id')
    .single();
  createdGroups.push(group.id);
  await service.from('passenger_requests').update({ group_id: group.id, status: 'matched' }).in('id', [uma.rideId, vic.rideId]);
  const urgentTicket = await ticketFor(uma, callback);
  // A third: call back, to plan and resolve.
  const xia = await person('Xia');
  const plainTicket = await ticketFor(xia, callback);
  const ours = new Set([whatsappTicket.id, urgentTicket.id, plainTicket.id]);

  // --- The inbox ---
  const listed = async (filter) => {
    let query = admin.client.from('support_tickets').select('id, urgent, created_at, channel, language, status');
    if (filter.status === 'active') query = query.neq('status', 'resolved');
    else if (filter.status) query = query.eq('status', filter.status);
    if (filter.channel) query = query.eq('channel', filter.channel);
    if (filter.language) query = query.eq('language', filter.language);
    const { data } = await query.order('urgent', { ascending: false }).order('created_at', { ascending: true });
    return (data ?? []).filter((row) => ours.has(row.id));
  };
  const inbox = await listed({ status: 'active' });
  check(
    'the inbox: the urgent ticket first, then the oldest',
    inbox.map((r) => r.id).join() === [urgentTicket.id, whatsappTicket.id, plainTicket.id].join() && inbox[0].urgent === true,
    inbox.map((r) => `${r.urgent ? 'U' : '-'}${r.channel[0]}`).join(' ')
  );
  check(
    '...filters by channel and language',
    (await listed({ status: 'active', channel: 'whatsapp' })).map((r) => r.id).join() === whatsappTicket.id &&
      (await listed({ status: 'active', language: 'fr' })).map((r) => r.id).join() === whatsappTicket.id
  );

  // --- Only the admin ---
  const notAdmin = await act(vic, urgentTicket.id, { action: 'note', body: 'hi' });
  const { data: vicSees } = await vic.client.from('support_tickets').select('id').in('id', [...ours]);
  check('a passenger can neither act on tickets nor read anyone else’s', notAdmin.status === 403 && (vicSees ?? []).length === 0, String(notAdmin.status));

  const noted = await act(admin, urgentTicket.id, { action: 'note', body: 'Passenger is at T1, gate area.' });
  const { data: umaSeesNotes } = await uma.client.from('support_ticket_events').select('id').eq('ticket_id', urgentTicket.id);
  const { data: adminSeesNotes } = await admin.client.from('support_ticket_events').select('kind, body').eq('ticket_id', urgentTicket.id);
  check(
    'an internal note is kept for the team - the passenger never reads it',
    noted.status === 200 && (adminSeesNotes ?? []).some((e) => e.kind === 'note' && /gate area/.test(e.body)) && (umaSeesNotes ?? []).length === 0
  );

  // --- Call back: no answer, the passenger replies, then chooses WhatsApp ---
  const noAnswer = await act(admin, urgentTicket.id, { action: 'no_answer' });
  let row = await ticketRow(urgentTicket.id);
  check(
    '"No answer": counted as a call, not as a contact',
    noAnswer.status === 200 && row.status === 'no_answer' && row.call_attempts === 1 && row.first_contact_at == null
  );
  const { data: umaTicket } = await uma.client.from('support_tickets').select('status').eq('id', urgentTicket.id).single();
  check('...the passenger sees "We tried to call you" on their own ticket', umaTicket?.status === 'no_answer');
  const back = await call(uma.client, 'help-chat', { action: 'start', language: 'en' });
  check('...and Help reopens that same conversation', back.data?.conversationId === urgentTicket.conversationId && back.data?.resumed === true);

  const reply = await call(uma.client, 'help-chat', { action: 'send', conversationId: urgentTicket.conversationId, message: 'Sorry, I was in the toilet. You can call me now.', language: 'en' });
  row = await ticketRow(urgentTicket.id);
  const { data: replyEvents } = await service.from('support_ticket_events').select('kind, body').eq('ticket_id', urgentTicket.id).eq('kind', 'passenger_replied');
  check(
    'their reply puts the ticket back to open, and the team sees it',
    reply.status === 200 && row.status === 'open' && (replyEvents ?? []).some((e) => /toilet/.test(e.body))
  );

  await act(admin, urgentTicket.id, { action: 'no_answer' });
  const toWhatsApp = await call(uma.client, 'support-handover', {
    action: 'create',
    conversationId: urgentTicket.conversationId,
    reason: 'user_asked',
    language: 'en',
    channel: 'whatsapp',
  });
  row = await ticketRow(urgentTicket.id);
  check(
    'after "No answer" the passenger can choose WhatsApp: same ticket, open again, number removed',
    toWhatsApp.data?.reference === urgentTicket.reference &&
      toWhatsApp.data?.whatsapp?.text === `Hi FLOQQ, I need help. Ticket #${urgentTicket.reference}` &&
      row.channel === 'whatsapp' &&
      row.status === 'open' &&
      row.callback_phone == null &&
      row.call_attempts === 2
  );

  // --- Call again later, then called - resolved ---
  const before = Date.now();
  const later = await act(admin, plainTicket.id, { action: 'call_later', minutes: 60 });
  row = await ticketRow(plainTicket.id);
  const plannedIn = (Date.parse(row.callback_at) - before) / 60_000;
  check('"Call again later": in progress, next call in an hour', later.status === 200 && row.status === 'in_progress' && plannedIn > 59 && plannedIn < 62, plannedIn.toFixed(1));

  const solved = await act(admin, plainTicket.id, { action: 'called_resolved', category: 'payment' });
  row = await ticketRow(plainTicket.id);
  const { data: xiaConversation } = await service.from('help_conversations').select('resolved_by').eq('id', plainTicket.conversationId).single();
  check(
    '"Called - resolved": closed with its category, first contact recorded, conversation resolved by the team',
    solved.status === 200 &&
      row.status === 'resolved' &&
      row.resolution_category === 'payment' &&
      row.first_contact_at != null &&
      row.call_attempts === 2 &&
      xiaConversation?.resolved_by === 'team'
  );
  const afterResolved = await act(admin, plainTicket.id, { action: 'no_answer' });
  check('a resolved ticket takes no more call actions', afterResolved.status === 409 && afterResolved.data?.error === 'already_resolved');
  const { data: xiaSees } = await xia.client.from('support_tickets').select('status').eq('id', plainTicket.id).single();
  check('...and the passenger sees "Resolved"', xiaSees?.status === 'resolved');

  // --- WhatsApp tickets ---
  const notCall = await act(admin, whatsappTicket.id, { action: 'no_answer' });
  check('a WhatsApp ticket has no call actions', notCall.status === 409 && notCall.data?.error === 'not_a_callback');
  const badCategory = await act(admin, whatsappTicket.id, { action: 'resolve', category: 'whatever' });
  const resolved = await act(admin, whatsappTicket.id, { action: 'resolve', category: 'app_bug' });
  row = await ticketRow(whatsappTicket.id);
  check(
    '"Resolve" needs one of the categories',
    badCategory.status === 409 && resolved.status === 200 && row.status === 'resolved' && row.resolution_category === 'app_bug'
  );

  // --- The ride, for the admin ---
  const { data: ride } = await admin.client.from('passenger_requests').select('flight_number, group_id').eq('id', urgentTicket.request_id).single();
  check("the admin sees the ride the ticket is about", ride?.flight_number === 'VY1803' && ride.group_id === group.id);
} catch (err) {
  failures += 1;
  console.error(`FAIL  ${err instanceof Error ? err.message : err}`);
} finally {
  console.log('Putting the WhatsApp setting back and deleting the test data...');
  await service.from('support_settings').update(savedSettings).eq('id', 1);
  for (const groupId of createdGroups) {
    await service.from('passenger_requests').update({ group_id: null }).eq('group_id', groupId);
    await service.from('group_events').delete().eq('group_id', groupId);
    await service.from('taxi_groups').delete().eq('id', groupId);
  }
  for (const user of createdUsers) {
    await service.from('support_tickets').delete().eq('user_id', user.id);
    await service.from('help_conversations').delete().eq('user_id', user.id);
    await service.from('passenger_requests').delete().eq('user_id', user.id);
    await service.from('user_roles').delete().eq('user_id', user.id);
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.warn(`could not delete ${user.email}: ${error.message}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
