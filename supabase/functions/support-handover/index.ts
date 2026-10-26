// Hands a help conversation over to the FLOQQ team.
//   { action: 'info', conversationId }  -> what the app needs before the passenger chooses: the
//                                          team's languages, whether the team is available now (and
//                                          when it will be), whether WhatsApp is offered, the
//                                          call-back slots, and whether the conversation was about
//                                          danger (the app then shows "call 112" first).
//   { action: 'create', conversationId, reason, language, channel, phone?, callbackAt?, consent? }
//                                       -> the ticket: a short reference, an AI summary in English for
//                                          the team, urgency, and an email alert to the team.
// The WhatsApp message the app opens carries only the ticket reference. The call-back number is
// stored on the ticket only. Settings (WhatsApp number, languages, hours, alert address) come from
// support_settings, never from the code.
//
// Deployed with the default JWT verification; the conversation must be the caller's.

import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { parsePhoneNumberFromString } from 'npm:libphonenumber-js@1.13.14';

import { sendEmail } from '../_shared/email.ts';
import { addUsage, costUsd, HELP_MODEL, HelpUsage } from '../_shared/helpChatRules.ts';
import {
  callbackSlots,
  isOfferedSlot,
  isOpen,
  isUrgent,
  makeReference,
  nextOpening,
  parseHandoverReason,
  parseSchedule,
  SUMMARY_INSTRUCTIONS,
  TEAM_LANGUAGES,
  transcript,
  whatsappDigits,
  whatsappMessage,
} from '../_shared/supportRules.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function loadSettings(admin: SupabaseClient) {
  const { data } = await admin.from('support_settings').select('whatsapp_number, team_languages, support_hours, alert_email').eq('id', 1).maybeSingle();
  const languages = ((data?.team_languages ?? []) as string[]).filter((l) => (TEAM_LANGUAGES as readonly string[]).includes(l));
  return {
    whatsappDigits: whatsappDigits(data?.whatsapp_number),
    teamLanguages: languages.length ? languages : ['en'],
    schedule: parseSchedule(data?.support_hours),
    alertEmail: typeof data?.alert_email === 'string' && data.alert_email.includes('@') ? data.alert_email : null,
  };
}

// The passenger's current or most recent ride, and the facts that make a ticket urgent.
async function rideFacts(admin: SupabaseClient, userId: string) {
  const { data: rides } = await admin
    .from('passenger_requests')
    .select('id, status, group_id, ready_at, arrival_at, completed_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  const ride = rides?.[0];
  if (!ride) return { requestId: null, urgent: false };
  const { data: group } = ride.group_id
    ? await admin.from('taxi_groups').select('status, meeting_time, ride_started_at, completed_at').eq('id', ride.group_id).maybeSingle()
    : { data: null };
  const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);
  const urgent = isUrgent(
    {
      groupStatus: group?.status ?? null,
      meetingMs: ms(group?.meeting_time) ?? ms(ride.ready_at ?? ride.arrival_at),
      rideStartedMs: ms(group?.ride_started_at),
      groupCompletedMs: ms(group?.completed_at),
      rideCompletedMs: ms(ride.completed_at),
    },
    Date.now()
  );
  const active = ride.completed_at == null && (ride.status === 'pending' || ride.status === 'matched');
  return { requestId: active || urgent ? ride.id : null, urgent };
}

// 2-3 sentences in English for the team. A ticket is never held up by this: null when it fails.
async function summarize(messages: { role: string; content: string }[]): Promise<{ summary: string | null; usage: HelpUsage | null }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey || messages.length === 0) return { summary: null, usage: null };
  try {
    const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
    const response = await client.messages.create({
      model: HELP_MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low' },
      system: SUMMARY_INSTRUCTIONS,
      messages: [{ role: 'user', content: `<conversation>\n${transcript(messages)}\n</conversation>` }],
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join(' ')
      .trim();
    return { summary: text ? text.slice(0, 1000) : null, usage: addUsage({ input_tokens: 0, output_tokens: 0 }, response.usage) };
  } catch (err) {
    console.error('ticket summary failed', err);
    return { summary: null, usage: null };
  }
}

const REASON_LABELS: Record<string, string> = {
  user_asked: 'asked for a person',
  not_solved: 'answered "No" to "Did this solve your problem?"',
  money_problem: 'money problem',
  safety: 'safety',
  dispute: 'dispute between passengers',
  account_change: 'account change (date of birth / deletion)',
  undecided_rule: 'question about something not decided yet',
  repeated_failure: 'the assistant could not solve it',
  other: 'other',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: userData } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  const user = userData.user;
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
  const { data: conversation } = await admin
    .from('help_conversations')
    .select('id, user_id, handover_reason')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conversation || conversation.user_id !== user.id) return jsonResponse({ error: 'not_found' }, 404);

  const settings = await loadSettings(admin);
  const now = Date.now();

  if (body.action === 'info') {
    const { count: dangerMessages } = await admin
      .from('help_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('emergency', true);
    const { data: existing } = await admin
      .from('support_tickets')
      .select('reference, channel, callback_at, status')
      .eq('conversation_id', conversation.id)
      .neq('status', 'resolved')
      .maybeSingle();
    const opening = nextOpening(settings.schedule, now);
    return jsonResponse({
      teamLanguages: settings.teamLanguages,
      openNow: isOpen(settings.schedule, now),
      nextOpenAt: opening != null ? new Date(opening).toISOString() : null,
      whatsapp: settings.whatsappDigits != null,
      callbackSlots: callbackSlots(settings.schedule, now),
      emergency: (dangerMessages ?? 0) > 0,
      existingTicket: existing ?? null,
    });
  }

  if (body.action !== 'create') return jsonResponse({ error: 'invalid_action' }, 400);

  const language = typeof body.language === 'string' && settings.teamLanguages.includes(body.language) ? body.language : null;
  if (!language) return jsonResponse({ error: 'invalid_language' }, 400);
  const channel = body.channel === 'whatsapp' || body.channel === 'callback' ? body.channel : null;
  if (!channel) return jsonResponse({ error: 'invalid_channel' }, 400);
  if (channel === 'whatsapp' && !settings.whatsappDigits) return jsonResponse({ error: 'whatsapp_unavailable' }, 409);

  let callbackPhone: string | null = null;
  let callbackAt: string | null = null;
  if (channel === 'callback') {
    const phone = typeof body.phone === 'string' ? parsePhoneNumberFromString(body.phone) : undefined;
    if (!phone || !phone.isValid()) return jsonResponse({ error: 'invalid_phone' }, 400);
    if (body.consent !== true) return jsonResponse({ error: 'consent_required' }, 400);
    callbackPhone = phone.number;
    // null: as soon as possible. Otherwise one of the slots on offer right now.
    if (body.callbackAt != null) {
      if (typeof body.callbackAt !== 'string' || !isOfferedSlot(body.callbackAt, settings.schedule, now)) {
        return jsonResponse({ error: 'invalid_callback_time' }, 400);
      }
      callbackAt = new Date(body.callbackAt).toISOString();
    }
  }

  // A double tap, or coming back to it: the conversation's open ticket is returned as it is. While
  // nobody has reached the passenger yet, they can change how: WhatsApp that didn't open becomes a
  // call back, and after "We tried to call you" they choose WhatsApp or another call back.
  const { data: existing } = await admin
    .from('support_tickets')
    .select('id, reference, channel, callback_at, urgent, language, status')
    .eq('conversation_id', conversation.id)
    .neq('status', 'resolved')
    .maybeSingle();
  const canChange = existing && (existing.status === 'no_answer' || (existing.status === 'open' && existing.channel !== channel));
  if (existing && canChange) {
    const { error } = await admin
      .from('support_tickets')
      .update({
        channel,
        status: 'open',
        callback_phone: callbackPhone,
        callback_at: callbackAt,
        callback_consent_at: channel === 'callback' ? new Date(now).toISOString() : null,
        language,
        updated_at: new Date(now).toISOString(),
      })
      .eq('id', existing.id);
    if (error) return jsonResponse({ error: 'ticket_failed' }, 500);
    const how =
      channel === 'whatsapp'
        ? 'WhatsApp'
        : `a call back ${callbackAt ? `at ${new Date(callbackAt).toLocaleString('en-GB', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' })} (Barcelona)` : 'as soon as possible'}`;
    await admin.from('support_ticket_events').insert({ ticket_id: existing.id, kind: 'channel_changed', body: how });
    if (settings.alertEmail) {
      await sendEmail({
        to: settings.alertEmail,
        subject: `${existing.urgent ? 'URGENT - ' : ''}Ticket #${existing.reference} now wants ${channel === 'whatsapp' ? 'WhatsApp' : 'a call back'}`,
        text: `Ticket #${existing.reference}: the passenger now wants ${how}.`,
      });
    }
    return jsonResponse({
      reference: existing.reference,
      channel,
      callbackAt,
      urgent: existing.urgent,
      whatsapp: channel === 'whatsapp' ? { digits: settings.whatsappDigits, text: whatsappMessage(language, existing.reference) } : null,
    });
  }
  if (existing) {
    return jsonResponse({
      reference: existing.reference,
      channel: existing.channel,
      callbackAt: existing.callback_at,
      urgent: existing.urgent,
      whatsapp: existing.channel === 'whatsapp' && settings.whatsappDigits
        ? { digits: settings.whatsappDigits, text: whatsappMessage(existing.language, existing.reference) }
        : null,
      existing: true,
    });
  }

  const reason = parseHandoverReason(body.reason ?? conversation.handover_reason);
  const facts = await rideFacts(admin, user.id);
  const requestId = facts.requestId;
  // The ride says so (about to meet the group, riding, just arrived), or the assistant saw the
  // passenger is stuck or in danger.
  const urgent = facts.urgent || reason === 'urgent' || reason === 'safety';
  const { data: messages } = await admin
    .from('help_messages')
    .select('role, content')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true })
    .limit(60);
  const { summary, usage } = await summarize(messages ?? []);

  let ticket: { id: string; reference: string } | null = null;
  for (let attempt = 0; attempt < 6 && !ticket; attempt += 1) {
    const reference = makeReference((max) => crypto.getRandomValues(new Uint32Array(1))[0] % max, attempt < 4 ? 4 : 5);
    const { data, error } = await admin
      .from('support_tickets')
      .insert({
        reference,
        user_id: user.id,
        conversation_id: conversation.id,
        request_id: requestId,
        category: reason,
        language,
        channel,
        callback_phone: callbackPhone,
        callback_at: callbackAt,
        callback_consent_at: channel === 'callback' ? new Date(now).toISOString() : null,
        urgent,
        summary,
        summary_cost_usd: usage ? costUsd(usage) : null,
      })
      .select('id, reference')
      .single();
    if (data) ticket = data;
    else if (error && error.code !== '23505') {
      console.error('creating a ticket failed', error);
      return jsonResponse({ error: 'ticket_failed' }, 500);
    }
  }
  if (!ticket) return jsonResponse({ error: 'ticket_failed' }, 500);

  await admin
    .from('help_conversations')
    .update({ handed_over_at: new Date(now).toISOString(), handover_reason: reason })
    .eq('id', conversation.id);

  let alertSent = false;
  if (settings.alertEmail) {
    const when = channel === 'callback' ? (callbackAt ? `call back at ${new Date(callbackAt).toLocaleString('en-GB', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' })} (Barcelona)` : 'call back as soon as possible') : 'WhatsApp';
    alertSent = await sendEmail({
      to: settings.alertEmail,
      subject: `${urgent ? 'URGENT - ' : ''}New support ticket #${ticket.reference}`,
      text: [
        `Ticket #${ticket.reference}${urgent ? ' - URGENT: at the airport' : ''}`,
        `Reason: ${REASON_LABELS[reason] ?? reason}`,
        `Channel: ${when}`,
        `Language: ${language.toUpperCase()}`,
        '',
        `Summary: ${summary ?? '(no summary - read the conversation in the admin)'}`,
        '',
        'Open the FLOQQ admin to see the full conversation.',
      ].join('\n'),
    });
  }

  return jsonResponse({
    reference: ticket.reference,
    channel,
    callbackAt,
    urgent,
    whatsapp: channel === 'whatsapp' ? { digits: settings.whatsappDigits, text: whatsappMessage(language, ticket.reference) } : null,
    // Whether the team's new-ticket email went out (false: not configured, or Resend refused it).
    alertSent,
  });
});
