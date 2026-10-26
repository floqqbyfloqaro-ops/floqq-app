// Checks, against the TEST Supabase project only, how a conversation is resolved and the handover
// to the FLOQQ team (help-chat + support-handover, 20261023040000_support_tickets.sql). It talks
// to the real model, so each run costs a few cents.
//   - a complete answer asks nothing and offers no team; "No, that's all" marks it resolved;
//   - "No" -> language -> WhatsApp: the message carries only the ticket reference, in the chosen
//     language; the ticket has an English summary for the team;
//   - call back: an invalid number, a missing consent or a time not on offer is refused; the
//     number is stored on the ticket only; a double tap gives the same ticket; WhatsApp that
//     didn't open switches the same ticket to a call back;
//   - outside support hours the passenger is told when the team is back;
//   - a passenger about to meet their group gets an URGENT ticket;
//   - a money problem and a TO DECIDE question make the assistant hand over by itself;
//   - nobody can see or use someone else's conversation.
// It changes the test project's support settings for a moment (and puts them back), creates its
// own throwaway users, rides and group, and deletes them again at the end.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Run with:
//   node --env-file=.env.test.local scripts/support-handover-test.mjs

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
const TEST_WHATSAPP = '+34 600 00 00 00';

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const createdUsers = [];
const createdGroups = [];

async function passenger(label, rideHoursAhead = null) {
  const email = `handover-test-${runId}-${label}@example.com`;
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
        flight_number: '',
        arrival_at: new Date(Date.now() + rideHoursAhead * HOUR).toISOString(),
        arrival_time_source: 'manual',
        arrival_terminal: 'T1',
        arrival_terminal_source: 'passenger',
        destination_address: 'Carrer Secret 12, Gràcia',
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

const chat = (who, body) => call(who.client, 'help-chat', body);
const handover = (who, body) => call(who.client, 'support-handover', body);
const ticketByReference = async (reference) =>
  (await service.from('support_tickets').select('*').eq('reference', reference).maybeSingle()).data;

const { data: savedSettings } = await service.from('support_settings').select('whatsapp_number, support_hours, alert_email').eq('id', 1).single();
const ALWAYS_OPEN = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '00:00', close: '24:00' }]));

try {
  // No alert emails for test tickets (scripts/support-alert-test.mjs checks the email on its own).
  await service.from('support_settings').update({ whatsapp_number: TEST_WHATSAPP, support_hours: ALWAYS_OPEN, alert_email: null }).eq('id', 1);

  // --- Solved by the assistant: "Yes" ---
  const ana = await passenger('Ana');
  const solved = await chat(ana, { action: 'start', language: 'en' });
  const solvedId = solved.data.conversationId;
  const fee = await chat(ana, { action: 'send', conversationId: solvedId, message: 'How much is the FLOQQ fee and when is it charged?', language: 'en' });
  console.log(`      > ${fee.data?.message?.content?.replace(/\n/g, ' ')}`);
  check(
    'a complete answer asks nothing and offers no team',
    fee.data?.handoverReason == null && fee.data?.message?.followup == null && fee.data?.conversation?.state === 'active',
    JSON.stringify({ followup: fee.data?.message?.followup, handover: fee.data?.handoverReason })
  );
  const yes = await chat(ana, { action: 'resolve', conversationId: solvedId });
  const { data: solvedRow } = await service.from('help_conversations').select('state, resolved_at, resolved_by').eq('id', solvedId).single();
  check(
    '"No, that\'s all" marks the conversation resolved by the assistant',
    yes.status === 200 && solvedRow?.state === 'resolved_by_assistant' && solvedRow.resolved_by === 'assistant' && solvedRow.resolved_at != null
  );

  // --- "No" -> language -> WhatsApp ---
  const ben = await passenger('Ben', 30);
  const notSolved = await chat(ben, { action: 'start', language: 'en' });
  const benId = notSolved.data.conversationId;
  await chat(ben, { action: 'send', conversationId: benId, message: "The arrow on the meeting screen doesn't show up at all.", language: 'en' });
  const info = await handover(ben, { action: 'info', conversationId: benId });
  check(
    'the team languages, WhatsApp and the call-back times are on offer',
    info.status === 200 && JSON.stringify(info.data.teamLanguages) === '["en","fr","es","it","nl"]' && info.data.whatsapp === true && info.data.openNow === true && info.data.callbackSlots.length > 0,
    JSON.stringify({ languages: info.data?.teamLanguages, open: info.data?.openNow, slots: info.data?.callbackSlots?.length })
  );
  // Dutch: one of the team languages the app itself isn't in.
  const whatsapp = await handover(ben, { action: 'create', conversationId: benId, reason: 'not_solved', language: 'nl', channel: 'whatsapp' });
  const reference = whatsapp.data?.reference;
  check(
    'WhatsApp: only the ticket reference, in the chosen language, to the configured number',
    whatsapp.status === 200 &&
      whatsapp.data.whatsapp?.text === `Hallo FLOQQ, ik heb hulp nodig. Ticket #${reference}` &&
      whatsapp.data.whatsapp?.digits === '34600000000' &&
      /^[A-Z2-9]{4,5}$/.test(reference ?? ''),
    JSON.stringify(whatsapp.data?.whatsapp)
  );
  const benTicket = await ticketByReference(reference);
  console.log(`      summary: ${benTicket?.summary}`);
  check(
    'the ticket: reason, language, channel, ride, and a short English summary for the team',
    benTicket?.category === 'not_solved' &&
      benTicket.language === 'nl' &&
      benTicket.channel === 'whatsapp' &&
      benTicket.request_id === ben.rideId &&
      benTicket.status === 'open' &&
      typeof benTicket.summary === 'string' &&
      /arrow/i.test(benTicket.summary) &&
      benTicket.summary.split(/[.!?](\s|$)/).filter((s) => s.trim()).length <= 4,
    JSON.stringify({ category: benTicket?.category, urgent: benTicket?.urgent })
  );
  check('...not urgent: the ride is 30 hours away', benTicket?.urgent === false);
  const again = await handover(ben, { action: 'create', conversationId: benId, reason: 'not_solved', language: 'fr', channel: 'whatsapp' });
  check('a double tap gives the same ticket, not a second one', again.data?.reference === reference && again.data?.existing === true);
  const switched = await handover(ben, {
    action: 'create',
    conversationId: benId,
    reason: 'not_solved',
    language: 'fr',
    channel: 'callback',
    phone: '+33612345678',
    callbackAt: null,
    consent: true,
  });
  const benAfter = await ticketByReference(reference);
  check(
    "WhatsApp didn't open: the same ticket becomes a call back",
    switched.data?.reference === reference && benAfter?.channel === 'callback' && benAfter.callback_phone === '+33612345678',
    benAfter?.channel
  );

  // --- Call back: checks ---
  const cleo = await passenger('Cleo');
  const cleoStart = await chat(cleo, { action: 'start', language: 'es' });
  const cleoId = cleoStart.data.conversationId;
  const cleoInfo = await handover(cleo, { action: 'info', conversationId: cleoId });
  const base = { action: 'create', conversationId: cleoId, reason: 'user_asked', language: 'es', channel: 'callback' };
  const badPhone = await handover(cleo, { ...base, phone: '+34123', callbackAt: null, consent: true });
  check('an invalid phone number is refused', badPhone.status === 400 && badPhone.data?.error === 'invalid_phone', JSON.stringify(badPhone.data));
  const noConsent = await handover(cleo, { ...base, phone: '+34612345678', callbackAt: null, consent: false });
  check('without consent there is no call back', noConsent.status === 400 && noConsent.data?.error === 'consent_required');
  const badTime = await handover(cleo, { ...base, phone: '+34612345678', callbackAt: new Date(Date.now() + 3 * 24 * HOUR).toISOString(), consent: true });
  check('a time that is not on offer is refused', badTime.status === 400 && badTime.data?.error === 'invalid_callback_time');
  const slot = cleoInfo.data.callbackSlots[0];
  const callback = await handover(cleo, { ...base, phone: '+34612345678', callbackAt: slot.at, consent: true });
  const cleoTicket = await ticketByReference(callback.data?.reference);
  check(
    'a valid call back: number, time and consent on the ticket',
    callback.status === 200 && cleoTicket?.callback_phone === '+34612345678' && cleoTicket.callback_at && Date.parse(cleoTicket.callback_at) === Date.parse(slot.at) && cleoTicket.callback_consent_at != null,
    JSON.stringify({ phone: cleoTicket?.callback_phone, at: cleoTicket?.callback_at })
  );
  const { data: cleoUser } = await service.auth.admin.getUserById(cleo.user.id);
  const { data: cleoProfile } = await service.from('user_payment_profiles').select('user_id').eq('user_id', cleo.user.id);
  check(
    '...and the number is on the ticket only - never on the account',
    !cleoUser.user.phone && !JSON.stringify(cleoUser.user.user_metadata ?? {}).includes('612345678') && (cleoProfile ?? []).length === 0
  );

  // --- Outside support hours ---
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const openHour = (nowHour + 6) % 23;
  const pad = (h) => String(h).padStart(2, '0');
  const LATER = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: `${pad(openHour)}:00`, close: `${pad(openHour + 1)}:00` }]));
  await service.from('support_settings').update({ support_hours: LATER }).eq('id', 1);
  const closed = await handover(cleo, { action: 'info', conversationId: cleoId });
  check(
    'outside support hours the passenger is told when the team is back',
    closed.data?.openNow === false && closed.data?.nextOpenAt != null && Date.parse(closed.data.nextOpenAt) > Date.now(),
    closed.data?.nextOpenAt
  );
  await service.from('support_settings').update({ support_hours: ALWAYS_OPEN }).eq('id', 1);

  // --- URGENT: about to meet the group ---
  const dani = await passenger('Dani', 1);
  const eli = await passenger('Eli', 1);
  const { data: group } = await service
    .from('taxi_groups')
    .insert({ status: 'confirmed', total_fare: 40, meeting_time: new Date(Date.now() + HOUR).toISOString() })
    .select('id')
    .single();
  createdGroups.push(group.id);
  await service.from('passenger_requests').update({ group_id: group.id, status: 'matched' }).in('id', [dani.rideId, eli.rideId]);
  const daniStart = await chat(dani, { action: 'start', language: 'en' });
  const urgent = await handover(dani, { action: 'create', conversationId: daniStart.data.conversationId, reason: 'user_asked', language: 'en', channel: 'whatsapp' });
  const daniTicket = await ticketByReference(urgent.data?.reference);
  check('a passenger about to meet their group gets an URGENT ticket', urgent.data?.urgent === true && daniTicket?.urgent === true && daniTicket.request_id === dani.rideId);

  // --- The assistant hands over by itself ---
  const money = await chat(dani, { action: 'send', conversationId: daniStart.data.conversationId, message: 'I was charged twice for this ride! Two payments on my card.', language: 'en' });
  console.log(`      > ${money.data?.message?.content?.replace(/\n/g, ' ')}`);
  check('a money problem: the assistant hands over by itself', money.data?.handoverReason === 'money_problem' && money.data?.message?.followup == null, money.data?.handoverReason);
  // Ana's first conversation is resolved, so read-only: a new one, as after "New conversation".
  const anaAgain = await chat(ana, { action: 'start', language: 'en', fresh: true });
  const undecided = await chat(ana, { action: 'send', conversationId: anaAgain.data.conversationId, message: "If someone in my group doesn't show up, do I get my €2.49 back?", language: 'en' });
  console.log(`      > ${undecided.data?.message?.content?.replace(/\n/g, ' ')}`);
  check(
    'a TO DECIDE question: no promise, and no team just for that',
    undecided.data?.handoverReason == null && !/you will (get|receive) (it|your|the €?2[.,]49) back/i.test(undecided.data?.message?.content ?? ''),
    undecided.data?.handoverReason
  );

  // --- Someone else's conversation ---
  const peek = await handover(eli, { action: 'info', conversationId: benId });
  const steal = await handover(eli, { action: 'create', conversationId: benId, reason: 'user_asked', language: 'en', channel: 'whatsapp' });
  const { data: eliSees } = await eli.client.from('support_tickets').select('id').eq('reference', reference);
  check("nobody can see or use someone else's conversation or ticket", peek.status === 404 && steal.status === 404 && (eliSees ?? []).length === 0);
} catch (err) {
  failures += 1;
  console.error(`FAIL  ${err instanceof Error ? err.message : err}`);
} finally {
  console.log('Putting the support settings back and deleting the test data...');
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
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.warn(`could not delete ${user.email}: ${error.message}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
