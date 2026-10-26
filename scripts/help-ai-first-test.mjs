// The AI-first help assistant (20261027010000_help_ai_first.sql, help-chat), against the TEST
// Supabase project and the real model (Claude Haiku 5.5) - a few cents per run. Scripted
// conversations in English, French and Spanish:
//   - "How do I cancel my request?" -> a confirmation card with what cancelling does to their
//     money -> "Cancel my ride" -> cancelled through cancel-passenger-request (its event marked
//     via: assistant) -> "Thanks!" -> a warm closing, resolved, no team;
//   - the same with "Keep it" -> nothing cancelled, the conversation carries on;
//   - a typed "yes" instead of the tap -> nothing cancelled, the card still waits;
//   - "Thanks", then "one more question" -> the same conversation carries on, no new greeting;
//     more than 10 minutes later -> read-only, a new conversation starts;
//   - "I want to talk to a person" for a simple question -> it offers to sort it out; again ->
//     the team;
//   - "Someone in my group is harassing me" -> the team at once;
//   - "I was charged twice" with nothing to explain it -> the team;
//   - "Do I get my money back if I cancel?" -> the app's real amount, no promise, no team;
//   - a frustrated message -> empathy and a solution, no team;
//   - the admin's figures count the assistant's actions and "asked for a person twice".
// It creates its own throwaway users, rides and groups and deletes them again at the end. With no
// Stripe key on the test project, cancelling doesn't touch Stripe; the money rules are covered by
// supabase/functions/_shared/helpActions.test.ts.
//
// Needs in .env.test.local: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY.
// Run with:
//   node --env-file=.env.test.local scripts/help-ai-first-test.mjs

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

// A passenger, optionally with a ride hoursAhead from now, in a confirmed group with a seat
// reserved on their card (hold: { freeUntilHours }).
async function person(label, ride) {
  const email = `aifirst-${runId}-${label}@example.com`;
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
        destination_address: 'Carrer de Mallorca 200, Eixample, Barcelona',
        destination_lat: 41.392,
        destination_lng: 2.158,
        large_luggage_count: 0,
        hand_luggage_count: 1,
        max_wait_minutes: 15,
        distance_km: 8,
      })
      .select('id')
      .single();
    if (rideError) throw new Error(`creating ${label}'s ride failed: ${rideError.message}`);
    rideId = row.id;
    if (ride.hold) {
      const { data: group } = await service
        .from('taxi_groups')
        .insert({ status: 'confirmed', total_fare: 50, meeting_time: new Date(Date.now() + ride.hoursAhead * HOUR).toISOString() })
        .select('id')
        .single();
      createdGroups.push(group.id);
      await service.from('passenger_requests').update({ group_id: group.id, status: 'matched' }).eq('id', rideId);
      await service.from('ride_payments').insert({
        request_id: rideId,
        group_id: group.id,
        user_id: data.user.id,
        estimated_share_cents: 2000,
        platform_fee_cents: 249,
        hold_amount_cents: 2749,
        payment_status: 'HOLD_PLACED',
        free_cancel_until: new Date(Date.now() + ride.hold.freeUntilHours * HOUR).toISOString(),
        stripe_payment_intent_id: `pi_aifirst_${runId}_${label}`,
        last_status_actor: 'system',
      });
    }
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

async function say(who, conversationId, message, language) {
  const answer = await call(who.client, { action: 'send', conversationId, message, language });
  const text = answer.data?.message?.content ?? '';
  console.log(`  [${who.label} ${language}] ${message}\n      > ${text.replace(/\n/g, ' ')}${answer.data?.message?.cards ? `\n      cards: ${JSON.stringify(answer.data.message.cards)}` : ''}`);
  const cards = answer.data?.message?.cards ?? [];
  return {
    status: answer.status,
    error: answer.data?.error ?? null,
    text,
    cards,
    cancelCard: cards.find((c) => c.type === 'confirm_cancel') ?? null,
    actions: answer.data?.message?.actions ?? [],
    emergency: answer.data?.emergency === true,
    handoverReason: answer.data?.handoverReason ?? null,
    state: answer.data?.conversation?.state ?? null,
  };
}

const decide = (who, actionId, decision, language) => call(who.client, { action: 'decide', actionId, decision, language });
const rideStatus = async (rideId) => (await service.from('passenger_requests').select('status').eq('id', rideId).single()).data?.status;
const conversationRow = async (id) =>
  (await service.from('help_conversations').select('state, closed_at, person_requests, handed_over_at').eq('id', id).single()).data;
const offersPerson = (text) => /talk to a person|contact the floqq team|parler à une personne|l’équipe floqq|hablar con una persona|equipo de floqq/i.test(text);

try {
  // --- Cancel through the card, then "Thanks!" - in three languages ---
  const flows = [
    ['en', 'How do I cancel my request?', 'Thanks!', /welcome|glad|great|trip|here/i],
    ['fr', 'Comment annuler ma demande ?', 'Merci !', /avec plaisir|je vous en prie|ravi|bon voyage|bonne/i],
    ['es', '¿Cómo cancelo mi solicitud?', '¡Gracias!', /de nada|un placer|buen viaje|aquí/i],
  ];
  for (const [language, question, thanks, warm] of flows) {
    const who = await person(`Cancel${language}`, { hoursAhead: 30 });
    const conversationId = await start(who, language);
    const asked = await say(who, conversationId, question, language);
    check(
      `${language}: "${question}" -> a confirmation card for her ride, nothing done yet`,
      asked.cancelCard?.status === 'pending' && asked.cancelCard.consequence?.kind === 'searching' && /Eixample|Mallorca/.test(asked.cancelCard.destination ?? '') && (await rideStatus(who.rideId)) === 'pending' && !asked.handoverReason,
      JSON.stringify(asked.cancelCard?.consequence)
    );
    const done = await decide(who, asked.cancelCard?.actionId, 'confirm', language);
    const { data: events } = await service.from('group_events').select('event_type, details').eq('request_id', who.rideId).eq('event_type', 'ride_cancelled');
    check(
      `${language}: "Cancel my ride" -> cancelled by the cancel function, the event marked "via assistant", "Done" said`,
      done.status === 200 && done.data?.status === 'done' && (await rideStatus(who.rideId)) === 'cancelled' && events?.[0]?.details?.via === 'assistant' && /cancel|annulé|cancelado/i.test(done.data?.message?.content ?? ''),
      `${done.data?.status} ${events?.[0]?.details?.via} ${done.data?.message?.content}`
    );
    const twice = await decide(who, asked.cancelCard?.actionId, 'confirm', language);
    check(`${language}: ...a second tap does nothing`, twice.status === 409, String(twice.status));
    const closing = await say(who, conversationId, thanks, language);
    check(
      `${language}: "${thanks}" -> a warm closing, resolved, no team`,
      closing.state === 'resolved_by_assistant' && warm.test(closing.text) && !closing.handoverReason && !offersPerson(closing.text) && !/\?/.test(closing.text),
      closing.state
    );
  }

  // --- "Keep it" ---
  const kim = await person('Kim', { hoursAhead: 30 });
  const keepId = await start(kim, 'en');
  const keepAsk = await say(kim, keepId, 'I want to cancel my ride', 'en');
  const kept = await decide(kim, keepAsk.cancelCard?.actionId, 'keep', 'en');
  check(
    '"Keep it" -> nothing cancelled, the conversation carries on',
    kept.data?.status === 'kept' && (await rideStatus(kim.rideId)) === 'pending' && kept.data?.conversation?.state === 'active',
    `${kept.data?.status} ${await rideStatus(kim.rideId)}`
  );

  // --- A typed "yes" ---
  const yan = await person('Yan', { hoursAhead: 30 });
  const yesId = await start(yan, 'en');
  const yesAsk = await say(yan, yesId, 'Cancel my ride please', 'en');
  const typedYes = await say(yan, yesId, 'yes', 'en');
  const { data: yesAction } = await service.from('help_actions').select('status').eq('id', yesAsk.cancelCard?.actionId ?? randomUUID()).maybeSingle();
  check(
    'a typed "yes" -> nothing cancelled, the card still waits, "tap the button"',
    yesAsk.cancelCard != null && (await rideStatus(yan.rideId)) === 'pending' && yesAction?.status === 'pending' && /tap|button/i.test(typedYes.text),
    typedYes.text.slice(0, 80)
  );

  // --- "Thanks", then one more question ---
  const omar = await person('Omar');
  const moreId = await start(omar, 'en');
  await say(omar, moreId, 'How much is the FLOQQ fee?', 'en');
  const thanked = await say(omar, moreId, 'Thanks, perfect', 'en');
  const more = await say(omar, moreId, 'Oh, one more question: can I bring a big suitcase?', 'en');
  check(
    '"Thanks", then "one more question" -> the same conversation carries on, no new greeting',
    thanked.state === 'resolved_by_assistant' && more.status === 200 && more.state === 'active' && !/^(hi|hello|hey)\b/i.test(more.text.trim()) && !/omar/i.test(more.text),
    `${thanked.state} -> ${more.state}`
  );
  await say(omar, moreId, 'Great, thanks!', 'en');
  await service.from('help_conversations').update({ closed_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq('id', moreId);
  const late = await say(omar, moreId, 'And another thing', 'en');
  check('...more than 10 minutes after the closing: read-only (the app starts a new, linked one)', late.status === 409 && late.error === 'conversation_closed', String(late.status));

  // --- Asking for a person ---
  const pia = await person('Pia');
  const personId = await start(pia, 'en');
  await say(pia, personId, 'How do I change the time of my ride?', 'en');
  const firstAsk = await say(pia, personId, 'I want to talk to a person', 'en');
  check(
    '"I want to talk to a person" for a simple question -> it offers to sort it out, no team yet',
    !firstAsk.handoverReason && (await conversationRow(personId))?.person_requests === 1,
    firstAsk.text.slice(0, 80)
  );
  const secondAsk = await say(pia, personId, 'No, I really want to talk to a human please', 'en');
  check('...asked again -> the team', secondAsk.handoverReason === 'user_asked', String(secondAsk.handoverReason));

  // --- Harassment ---
  const hana = await person('Hana', { hoursAhead: 1 });
  const harassId = await start(hana, 'en');
  const harass = await say(hana, harassId, 'Someone in my group is harassing me', 'en');
  check('"Someone in my group is harassing me" -> the team at once', harass.handoverReason === 'safety' || harass.handoverReason === 'dispute', String(harass.handoverReason));

  // --- Charged twice, nothing to explain it ---
  const carl = await person('Carl');
  const twiceId = await start(carl, 'en');
  const charged = await say(carl, twiceId, 'I was charged twice by FLOQQ!', 'en');
  check('"I was charged twice" with no payment to explain it -> the team', charged.handoverReason === 'money_problem', String(charged.handoverReason));

  // --- The refund question: the app's own amount ---
  const rita = await person('Rita', { hoursAhead: 10, hold: { freeUntilHours: -14 } });
  const refundId = await start(rita, 'fr');
  const refund = await say(rita, refundId, 'Si j’annule maintenant, est-ce que je suis remboursée ?', 'fr');
  check(
    'the refund question -> the app\'s real amounts (the €2.49 kept, the rest released), no promise, no team',
    /2,49|2\.49/.test(refund.text + JSON.stringify(refund.cards)) && !refund.handoverReason && !/vous serez rembours[ée]e intégralement/i.test(refund.text),
    refund.text.slice(0, 100)
  );

  // --- Frustration ---
  const finn = await person('Finn', { hoursAhead: 30 });
  const angryId = await start(finn, 'en');
  const angry = await say(finn, angryId, "THIS APP IS USELESS!!! I CAN'T FIND WHERE TO CHANGE MY ARRIVAL TIME", 'en');
  check(
    'a frustrated message -> empathy and the way to do it, no team',
    !angry.handoverReason && /sorry|frustrat/i.test(angry.text) && (angry.actions.includes('edit_ride') || /edit|my ride/i.test(angry.text)),
    `${angry.handoverReason} ${angry.actions.join(',')}`
  );

  // --- A false alarm: the 112 card, but no forced hand-over ---
  const pol = await person('Pol', { hoursAhead: 1 });
  const policeId = await start(pol, 'en');
  const police = await say(pol, policeId, 'The police officer at the taxi rank told me to wait here, is that ok for my group?', 'en');
  console.log(`      (a word like "police" shows the 112 card: ${police.emergency}; handed over: ${police.handoverReason})`);

  // --- The admin's figures ---
  const ada = await person('Ada');
  await service.from('user_roles').insert({ user_id: ada.user.id, role: 'admin' });
  const { data: metrics, error: metricsError } = await ada.client.rpc('admin_help_metrics', { p_from: new Date(Date.now() - DAY).toISOString() });
  check(
    "the admin's figures: the assistant's cancellations, without a person, asked for a person twice",
    !metricsError && (metrics.assistant_actions?.cancel_ride ?? 0) >= 3 && metrics.asked_person_twice >= 1 && metrics.without_person >= 5,
    metricsError?.message ?? JSON.stringify({ actions: metrics.assistant_actions, twice: metrics.asked_person_twice, without: metrics.without_person, of: metrics.conversations })
  );
} catch (err) {
  failures += 1;
  console.error(`FAIL  ${err instanceof Error ? err.stack : err}`);
} finally {
  console.log('Deleting the test data...');
  for (const user of createdUsers) {
    // Their audit rows first: payment_events won't let a payment row go while it points at it.
    const { data: payments } = await service.from('ride_payments').select('id').eq('user_id', user.id);
    if (payments?.length) await service.from('payment_events').delete().in('ride_payment_id', payments.map((p) => p.id));
    await service.from('ride_payments').delete().eq('user_id', user.id);
  }
  for (const groupId of createdGroups) {
    await service.from('passenger_requests').update({ group_id: null }).eq('group_id', groupId);
    await service.from('group_events').delete().eq('group_id', groupId);
    await service.from('taxi_groups').delete().eq('id', groupId);
  }
  for (const user of createdUsers) {
    await service.from('support_tickets').delete().eq('user_id', user.id);
    await service.from('help_conversations').delete().eq('user_id', user.id);
    const { data: rides } = await service.from('passenger_requests').select('id').eq('user_id', user.id);
    if (rides?.length) await service.from('group_events').delete().in('request_id', rides.map((r) => r.id));
    await service.from('passenger_requests').delete().eq('user_id', user.id);
    await service.from('user_roles').delete().eq('user_id', user.id);
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) console.warn(`could not delete ${user.email}: ${error.message}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
