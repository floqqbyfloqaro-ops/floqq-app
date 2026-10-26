// How help conversations end (20261027000000_help_conversation_states.sql, help-chat), against the
// TEST Supabase project and the real model (Claude Haiku 5.5) - a few cents per run. In English,
// French and Spanish:
//   - "Merci, c'est parfait" after an answer -> a warm closing, resolved, in "Your requests", no
//     team offered;
//   - a complete answer, then silence for the timer -> closed_no_reply (the silence job);
//   - an unclear reaction -> no generic "Anything else?": the passenger leads;
//   - "This didn't help" -> it tries again; still stuck -> the team; "Quiero hablar con una
//     persona" right after a correct answer -> it offers to sort it out first; a frustrated
//     passenger at the airport -> empathy and a solution, no team just for that;
//   - a successful answer never offers the team;
//   - "I still need help with this" -> a new conversation that knows the earlier one;
//   - it never asks for ride details the app already has;
//   - archived conversations are read-only; the admin's figures count all of it.
// It creates its own throwaway users and rides and deletes them again at the end.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Run with:
//   node --env-file=.env.test.local scripts/help-endings-test.mjs

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
const DAY = 24 * HOUR;

let failures = 0;
function check(label, passed, detail = '') {
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const createdUsers = [];
const createdGroups = [];

async function person(label, ride) {
  const email = `endings-${runId}-${label}@example.com`;
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
    const { data: row, error: rideError } = await service
      .from('passenger_requests')
      .insert({
        user_id: data.user.id,
        passenger_name: `${label} Test`,
        flight_number: 'VY1803',
        arrival_at: new Date(Date.now() + ride.hoursAhead * HOUR).toISOString(),
        arrival_time_source: 'manual',
        arrival_terminal: 'T1',
        arrival_terminal_source: 'passenger',
        destination_address: 'Plaça de Catalunya, Barcelona',
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

async function start(who, language, extra = {}) {
  const started = await call(who.client, { action: 'start', language, fresh: true, ...extra });
  if (started.status !== 200) throw new Error(`start failed for ${who.label}: ${JSON.stringify(started.data)}`);
  return started.data.conversationId;
}

// One message, as the app sends it; what came back, and the conversation's state after it.
async function say(who, conversationId, message, language) {
  const answer = await call(who.client, { action: 'send', conversationId, message, language });
  const text = answer.data?.message?.content ?? '';
  console.log(`  [${who.label} ${language}] ${message}\n      > ${text.replace(/\n/g, ' ')}`);
  return {
    status: answer.status,
    text,
    followup: answer.data?.message?.followup ?? null,
    handoverReason: answer.data?.handoverReason ?? null,
    actions: answer.data?.message?.actions ?? [],
    state: answer.data?.conversation?.state ?? null,
    title: answer.data?.conversation?.title ?? null,
  };
}

const conversationRow = async (id) =>
  (await service.from('help_conversations').select('state, title, answered_at, followup_asked, previous_conversation_id').eq('id', id).single()).data;

const asksForPerson = (text) => /talk to a person|parler à une personne|hablar con una persona|contact the floqq team|l’équipe floqq|equipo de floqq/i.test(text);

try {
  // --- "Merci, c'est parfait" after an answer, in three languages ---
  const thanks = [
    ['en', 'How much is the FLOQQ fee?', 'Thanks, perfect!', /glad|great|enjoy|safe trip|have a/i],
    ['fr', 'Combien coûtent les frais FLOQQ ?', "Merci, c'est parfait", /ravi|parfait|bon voyage|bonne/i],
    ['es', '¿Cuánto cuesta la tarifa de FLOQQ?', 'Vale, gracias 👍', /genial|me alegra|buen viaje|perfecto|de nada/i],
  ];
  const resolvedIds = [];
  for (const [language, question, done, warm] of thanks) {
    const who = await person(`Thanks${language}`);
    const conversationId = await start(who, language);
    const first = await say(who, conversationId, question, language);
    check(
      `${language}: a correct answer offers no team and asks nothing`,
      !first.handoverReason && !first.followup && !asksForPerson(first.text) && first.state === 'active',
      JSON.stringify({ handover: first.handoverReason, followup: first.followup, state: first.state })
    );
    const closing = await say(who, conversationId, done, language);
    check(
      `${language}: "${done}" -> a short warm closing, resolved, no team`,
      closing.state === 'resolved_by_assistant' && warm.test(closing.text) && !closing.handoverReason && !/\?/.test(closing.text) && closing.text.length < 200,
      closing.state
    );
    check(`${language}: ...with a title`, typeof closing.title === 'string' && closing.title.length > 0, closing.title);
    // In "Your requests": the passenger reads it themselves (row level security).
    const { data: archive } = await who.client.from('help_conversations').select('id, state, title').eq('id', conversationId);
    check(`${language}: ...in "Your requests"`, archive?.[0]?.state === 'resolved_by_assistant');
    // Within 10 minutes it would reopen (help-ai-first-test checks that); after them it's read-only.
    await service.from('help_conversations').update({ closed_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq('id', conversationId);
    const afterwards = await call(who.client, { action: 'send', conversationId, message: 'one more', language });
    check(`${language}: ...and read-only after 10 minutes`, afterwards.status === 409 && afterwards.data?.error === 'conversation_closed');
    resolvedIds.push({ who, conversationId, language });
  }

  // --- A complete answer, then silence ---
  const sam = await person('Sam');
  const silentId = await start(sam, 'en');
  const silent = await say(sam, silentId, 'How long does matching take?', 'en');
  const beforeSilence = await conversationRow(silentId);
  check('a complete answer starts the silence timer', silent.state === 'active' && beforeSilence?.answered_at != null);
  const { data: settings } = await service.from('support_settings').select('no_reply_close_minutes').eq('id', 1).single();
  await service.rpc('help_close_silent_conversations');
  check('...not closed before the timer', (await conversationRow(silentId))?.state === 'active');
  await service
    .from('help_conversations')
    .update({ answered_at: new Date(Date.now() - (settings.no_reply_close_minutes + 1) * 60_000).toISOString() })
    .eq('id', silentId);
  await service.rpc('help_close_silent_conversations');
  const afterSilence = await conversationRow(silentId);
  check(`...closed without reply after ${settings.no_reply_close_minutes} minutes, with a title`, afterSilence?.state === 'closed_no_reply' && afterSilence.title != null, afterSilence?.state);

  // --- An unclear reaction: no "Anything else?" ---
  const uma = await person('Uma');
  const unclearId = await start(uma, 'en');
  await say(uma, unclearId, 'How do I cancel my ride?', 'en');
  const unclear = await say(uma, unclearId, 'ok', 'en');
  check(
    'an unclear "ok" -> no generic "Anything else?" (it carries on, or takes it as a sign-off)',
    (unclear.state === 'active' || unclear.state === 'resolved_by_assistant') && !/anything else|let me know if|would you like more/i.test(unclear.text),
    unclear.text.slice(0, 80)
  );

  // --- "This didn't help" ---
  const nia = await person('Nia', { hoursAhead: 72 });
  const notHelpedId = await start(nia, 'en');
  await say(nia, notHelpedId, "Why haven't I been matched yet?", 'en');
  const notHelped = await say(nia, notHelpedId, "This didn't help at all, I still have no group.", 'en');
  check('"This didn\'t help" once -> it tries again, no team yet', !notHelped.handoverReason, String(notHelped.handoverReason));
  const stillStuck = await say(nia, notHelpedId, "That still doesn't help me, I'm still stuck without a group.", 'en');
  check('...still stuck after two tries -> the team', stillStuck.handoverReason != null, String(stillStuck.handoverReason));

  // --- "Quiero hablar con una persona" right after a correct answer ---
  const pau = await person('Pau');
  const personId = await start(pau, 'es');
  const correct = await say(pau, personId, '¿Cómo cambio mi tarjeta?', 'es');
  check('es: the correct answer offers no team', !correct.handoverReason && !asksForPerson(correct.text));
  const asked = await say(pau, personId, 'Quiero hablar con una persona', 'es');
  check('"Quiero hablar con una persona" the first time -> it offers to sort it out, no team yet', !asked.handoverReason, String(asked.handoverReason));
  const askedAgain = await say(pau, personId, 'No, quiero hablar con una persona, por favor', 'es');
  check('...asked again -> the team at once', askedAgain.handoverReason === 'user_asked', String(askedAgain.handoverReason));

  // --- Frustrated at the airport ---
  const fay = await person('Fay', { hoursAhead: 0.5 });
  const { data: group } = await service
    .from('taxi_groups')
    .insert({ status: 'confirmed', total_fare: 40, meeting_time: new Date(Date.now() + 0.5 * HOUR).toISOString() })
    .select('id')
    .single();
  createdGroups.push(group.id);
  await service.from('passenger_requests').update({ group_id: group.id, status: 'matched' }).eq('id', fay.rideId);
  const frustratedId = await start(fay, 'en');
  // Frustration alone (not something broken): their group is still being looked for.
  await service.from('passenger_requests').update({ group_id: null, status: 'pending' }).eq('id', fay.rideId);
  const frustrated = await say(fay, frustratedId, 'THIS IS SO ANNOYING!!! WHY IS IT TAKING SO LONG TO FIND ME A GROUP???', 'en');
  check(
    'a frustrated passenger -> empathy and an explanation, no team just for that',
    /sorry|let's|frustrat|stress|understand|hear you|annoying/i.test(frustrated.text) && /5 minutes|match|group/i.test(frustrated.text) && frustrated.handoverReason == null,
    `${frustrated.handoverReason} ${frustrated.actions.join(',')}`
  );

  // --- It never asks for ride details the app already has ---
  const ray = await person('Ray', { hoursAhead: 26 });
  const rideId = await start(ray, 'fr');
  const rideAnswer = await say(ray, rideId, "C'est quand mon trajet ?", 'fr');
  // Asking = a sentence ending in "?" about the flight, terminal or time.
  const questions = rideAnswer.text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim().endsWith('?'));
  check(
    'the ride question: answered from the app, no flight / terminal / time asked',
    !questions.some((q) => /vol|flight|terminal|numéro|heure|time/i.test(q)) && /\d/.test(rideAnswer.text),
    rideAnswer.text.slice(0, 80)
  );

  // --- "I still need help with this" ---
  const [{ who: back, conversationId: earlierId }] = resolvedIds;
  const linkedId = await start(back, 'en', { previousConversationId: earlierId });
  check('"I still need help with this" -> a new conversation linked to the earlier one', linkedId !== earlierId && (await conversationRow(linkedId))?.previous_conversation_id === earlierId);
  const followOn = await say(back, linkedId, 'Actually, when exactly is it charged?', 'en');
  check(
    '...and the assistant knows what it was about (the fee), without asking',
    /2[.,]49|fee/i.test(followOn.text) && !/what (is it|are you asking) about|which (fee|payment)/i.test(followOn.text)
  );
  const otherOne = await call(pau.client, { action: 'start', language: 'en', fresh: true, previousConversationId: earlierId });
  check("...nobody can link to someone else's conversation", otherOne.status === 404, String(otherOne.status));
  const opened = await call(back.client, { action: 'open', conversationId: earlierId });
  const notTheirs = await call(pau.client, { action: 'open', conversationId: earlierId });
  check('the archive opens the earlier conversation read-only, only for its passenger', opened.status === 200 && opened.data?.messages?.length >= 4 && notTheirs.status === 404);

  // --- The admin's figures ---
  // The French passenger asks for a person after her conversation was resolved.
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const reference = Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  const { error: ticketError } = await service.from('support_tickets').insert({
    reference,
    user_id: resolvedIds[1].who.user.id,
    category: 'user_asked',
    language: 'fr',
    channel: 'whatsapp',
  });
  if (ticketError) throw new Error(`creating the ticket failed: ${ticketError.message}`);
  const ada = await person('Ada');
  await service.from('user_roles').insert({ user_id: ada.user.id, role: 'admin' });
  const { data: metrics, error: metricsError } = await ada.client.rpc('admin_help_metrics', { p_from: new Date(Date.now() - DAY).toISOString() });
  check(
    "the admin's figures: resolved by the assistant, closed without reply, a person asked after 'resolved'",
    !metricsError && metrics.resolved_by_assistant >= 3 && metrics.closed_no_reply >= 1 && metrics.person_after_resolved >= 1 && 'resolved_by_team' in metrics,
    metricsError?.message ?? JSON.stringify({ a: metrics.resolved_by_assistant, c: metrics.closed_no_reply, p: metrics.person_after_resolved })
  );
} catch (err) {
  failures += 1;
  console.error(`FAIL  ${err instanceof Error ? err.stack : err}`);
} finally {
  console.log('Deleting the test data...');
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
