// The AI support assistant behind "Help" (Claude Haiku 5.5). The Anthropic key lives only in this
// function's secrets, never in the app.
//   { action: 'start', language }                       -> a new conversation, opened with the
//                                                          fixed "I'm an AI assistant" greeting.
//   { action: 'send', conversationId, message, language } -> the assistant's answer, and whether
//                                                          to ask "Did this solve your problem?"
//                                                          or to hand over to the team.
//   { action: 'resolve', conversationId }                -> "Yes": resolved by the assistant.
// It answers from the published knowledge base (help_articles) and the passenger's own data,
// which it reads itself through two read-only tools scoped to the signed-in user - it can never
// change anything, and never sees other passengers' data. A message suggesting danger always gets
// the fixed "call 112 now" line first, even if the model is unreachable. The history comes from
// help_messages, never from the app. Rate limited per user, with a maximum message length.
//
// Deployed with the default JWT verification (any logged-in app user may call this).

import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  addUsage,
  appContext,
  costUsd,
  detectEmergency,
  HELP_HISTORY_MESSAGES,
  HELP_MAX_MESSAGE_CHARS,
  HELP_MAX_TOOL_ROUNDS,
  HELP_MODEL,
  HELP_RATE_LIMIT_PER_HOUR,
  HELP_TEXTS,
  HelpUsage,
  KnowledgeArticle,
  parseHelpLanguage,
  replayedAnswer,
  sanitizeUserText,
  systemPrompt,
} from '../_shared/helpChatRules.ts';
import type { HelpLanguage } from '../_shared/helpKnowledgeBase.ts';
import { HandoverReason, parseHandoverReason } from '../_shared/supportRules.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// The two read-only tools. Stable order and wording: they are part of the cached prefix.
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_my_rides',
    description:
      "The signed-in passenger's own rides: the current one (if any) and up to 5 earlier ones, each with its status, its group's status, the meeting point, the meeting time, and whether this passenger pays the taxi. Read-only. Contains nothing about other passengers beyond how many are in the group.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_my_payments',
    description:
      "The signed-in passenger's own payments for their last rides: what is reserved on their card, what was charged and released, what failed or is outstanding, and - when they paid the taxi - the reimbursement to them. Also whether they have a saved card. Read-only. Amounts in euros.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  // Signals for the app - they change nothing.
  {
    name: 'offer_resolution_check',
    description:
      'Call this together with an answer that fully answers the question or gives a complete solution. The app then asks the passenger "Did this solve your problem?". Changes nothing.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'hand_over',
    description:
      'Call this when the Bot rules say the conversation must go to a person from the FLOQQ team. The app then helps the passenger reach the team (WhatsApp or a call back). Changes nothing by itself.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: ['user_asked', 'money_problem', 'safety', 'dispute', 'account_change', 'undecided_rule', 'repeated_failure', 'other'],
          description: 'Why it goes to a person.',
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
];

const SIGNAL_TOOLS = new Set(['offer_resolution_check', 'hand_over']);

const PAYMENT_STATUS_MEANING: Record<string, string> = {
  NOT_STARTED: 'nothing reserved on the card yet',
  HOLD_PENDING_AUTH: "waiting for the bank's verification - nothing reserved yet",
  HOLD_PLACED: 'amount reserved on the card (a hold, not a charge)',
  HOLD_FAILED: 'reserving on the card failed',
  CAPTURED: 'charged; the unused part of the reservation was released',
  CAPTURE_FAILED: 'charging the card failed - the FLOQQ team follows up',
  RELEASED: 'reservation released - nothing charged',
  REFUNDED: 'refunded',
};

const euros = (cents: number | null | undefined) => (cents == null ? null : `€${(cents / 100).toFixed(2)}`);
const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : null);

type Ride = {
  id: string;
  status: string;
  group_id: string | null;
  arrival_at: string;
  ready_at: string | null;
  arrival_terminal: string | null;
  flight_number: string | null;
  destination_address: string;
  completed_at: string | null;
  no_show_at: string | null;
  created_at: string;
};

const RIDE_COLUMNS =
  'id, status, group_id, arrival_at, ready_at, arrival_terminal, flight_number, destination_address, completed_at, no_show_at, created_at';

// Everything below reads only rows that belong to this user (service role, always filtered by
// user id), and only the fields a passenger may know about their own ride.
async function loadRides(admin: SupabaseClient, userId: string) {
  const { data } = await admin
    .from('passenger_requests')
    .select(RIDE_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(6);
  const rides = (data ?? []) as Ride[];
  const current = rides.find((r) => (r.status === 'pending' || r.status === 'matched') && !r.completed_at) ?? null;
  return { current, earlier: rides.filter((r) => r !== current).slice(0, 5) };
}

async function describeRide(admin: SupabaseClient, ride: Ride, language: HelpLanguage) {
  let group: Record<string, unknown> | null = null;
  if (ride.group_id) {
    const { data: g } = await admin
      .from('taxi_groups')
      .select('status, meeting_point_id, meeting_time, offer_expires_at, ride_started_at, meetup_completed_at, meetup_flagged_at, completed_at, payer_request_id')
      .eq('id', ride.group_id)
      .maybeSingle();
    if (g) {
      const { count } = await admin
        .from('passenger_requests')
        .select('id', { count: 'exact', head: true })
        .eq('group_id', ride.group_id);
      let meetingPoint: string | null = null;
      if (g.meeting_point_id) {
        const { data: point } = await admin
          .from('meeting_points')
          .select('short_code, terminal, name_i18n')
          .eq('id', g.meeting_point_id)
          .maybeSingle();
        if (point) {
          const names = (point.name_i18n ?? {}) as Record<string, string>;
          const name = names[language] ?? names.en;
          meetingPoint = `${name ? `${name} ` : ''}(${point.short_code}, terminal ${point.terminal}) - the app's meeting point card has the photo and directions`;
        }
      }
      group = {
        group_status: g.status === 'unconfirmed' ? 'match found - waiting for everyone to secure their spot' : g.status,
        passengers_in_group: count ?? null,
        offer_answer_deadline: g.status === 'unconfirmed' ? g.offer_expires_at : null,
        meeting_point: meetingPoint,
        meeting_time: g.meeting_time,
        group_found_each_other: g.meetup_completed_at != null,
        ride_started: g.ride_started_at != null,
        under_floqq_review_because_group_never_met: g.meetup_flagged_at != null,
        group_ride_completed: g.completed_at != null,
        this_passenger_pays_the_taxi: g.payer_request_id === ride.id,
      };
    }
  }
  return {
    ride: shortId(ride.id),
    status:
      ride.completed_at != null
        ? 'completed'
        : ride.status === 'pending'
          ? 'searching for a match'
          : ride.status === 'matched'
            ? 'in a group'
            : ride.status,
    flight: ride.flight_number || null,
    terminal: ride.arrival_terminal,
    arrival_time: ride.arrival_at,
    ready_at_meeting_point_from: ride.ready_at,
    destination: ride.destination_address,
    marked_no_show: ride.no_show_at != null,
    group,
  };
}

async function getMyRides(admin: SupabaseClient, userId: string, language: HelpLanguage) {
  const { current, earlier } = await loadRides(admin, userId);
  return {
    times_are_utc: true,
    current_ride: current ? await describeRide(admin, current, language) : null,
    earlier_rides: await Promise.all(earlier.map((ride) => describeRide(admin, ride, language))),
  };
}

async function getMyPayments(admin: SupabaseClient, userId: string) {
  const [{ data: payments }, { data: profile }, { data: paidGroups }] = await Promise.all([
    admin
      .from('ride_payments')
      .select(
        'request_id, payment_status, estimated_share_cents, platform_fee_cents, hold_amount_cents, final_share_cents, captured_cents, released_cents, charge_at, failure_reason, outstanding_cents, outstanding_resolved_at, free_cancel_until, hold_deadline_at, created_at'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
    admin.from('user_payment_profiles').select('has_default_payment_method, payout_onboarding_status').eq('user_id', userId).maybeSingle(),
    admin.from('taxi_groups').select('id').eq('payer_user_id', userId).order('created_at', { ascending: false }).limit(5),
  ]);
  const groupIds = (paidGroups ?? []).map((g) => g.id);
  const { data: payouts } = groupIds.length
    ? await admin.from('ride_payouts').select('payer_request_id, amount_cents, status, sent_at').in('group_id', groupIds)
    : { data: [] };

  return {
    times_are_utc: true,
    saved_card: profile?.has_default_payment_method === true,
    payout_account_setup: profile?.payout_onboarding_status ?? 'NOT_STARTED',
    payments: (payments ?? []).map((p) => ({
      ride: shortId(p.request_id),
      status: p.payment_status,
      meaning: PAYMENT_STATUS_MEANING[p.payment_status] ?? p.payment_status,
      reserved_on_card: euros(p.hold_amount_cents),
      estimated_share: euros(p.estimated_share_cents),
      floqq_fee: euros(p.platform_fee_cents),
      final_share: euros(p.final_share_cents),
      charged: euros(p.captured_cents),
      released: euros(p.released_cents),
      card_charged_after: p.charge_at,
      reserve_before: p.payment_status === 'NOT_STARTED' || p.payment_status === 'HOLD_FAILED' ? p.hold_deadline_at : null,
      free_cancellation_until: p.free_cancel_until,
      problem: p.failure_reason,
      outstanding: p.outstanding_cents && !p.outstanding_resolved_at ? euros(p.outstanding_cents) : null,
    })),
    reimbursements_to_this_passenger_as_payer: (payouts ?? []).map((p) => ({
      ride: shortId(p.payer_request_id),
      amount: euros(p.amount_cents),
      status: p.status,
      sent_at: p.sent_at,
    })),
  };
}

async function currentRideSummary(admin: SupabaseClient, userId: string, language: HelpLanguage): Promise<string> {
  const { current } = await loadRides(admin, userId);
  if (!current) return 'none';
  return JSON.stringify(await describeRide(admin, current, language));
}

// Asks the model, running its read-only tools as often as it needs (within limits).
async function answer(args: {
  admin: SupabaseClient;
  userId: string;
  language: HelpLanguage;
  history: Anthropic.MessageParam[];
  userText: string;
  emergency: boolean;
}): Promise<{
  text: string;
  usage: HelpUsage;
  toolsUsed: string[];
  refused: boolean;
  resolutionCheck: boolean;
  handoverReason: HandoverReason | null;
}> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });

  const { data: articles } = await args.admin
    .from('help_articles')
    .select('section_key, language, sort_order, title, content, status')
    .eq('status', 'published');
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt((articles ?? []) as KnowledgeArticle[], args.language), cache_control: { type: 'ephemeral' } },
  ];

  const context = appContext({
    language: args.language,
    nowIso: new Date().toISOString(),
    currentRide: await currentRideSummary(args.admin, args.userId, args.language),
    emergencyLineShown: args.emergency,
  });
  const messages: Anthropic.MessageParam[] = [
    ...args.history,
    { role: 'user', content: [{ type: 'text', text: context }, { type: 'text', text: args.userText }] },
  ];

  let usage: HelpUsage = { input_tokens: 0, output_tokens: 0 };
  const toolsUsed: string[] = [];
  let resolutionCheck = false;
  let handoverReason: HandoverReason | null = null;

  for (let round = 0; round <= HELP_MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.messages.create({
      model: HELP_MODEL,
      max_tokens: 2048,
      output_config: { effort: 'low' },
      system,
      tools: TOOLS,
      // On the last round it must answer with what it has.
      tool_choice: round === HELP_MAX_TOOL_ROUNDS ? { type: 'none' } : { type: 'auto' },
      messages,
    });
    usage = addUsage(usage, response.usage);

    if (response.stop_reason === 'refusal') return { text: '', usage, toolsUsed, refused: true, resolutionCheck: false, handoverReason: null };

    const toolCalls = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    for (const call of toolCalls) {
      if (call.name === 'offer_resolution_check') resolutionCheck = true;
      if (call.name === 'hand_over') handoverReason = parseHandoverReason((call.input as { reason?: unknown })?.reason);
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    // Done: no tool to run, or only signals next to an answer that is already written.
    const onlySignals = toolCalls.every((call) => SIGNAL_TOOLS.has(call.name));
    if (response.stop_reason !== 'tool_use' || toolCalls.length === 0 || (onlySignals && text)) {
      return {
        text,
        usage,
        toolsUsed,
        refused: text.length === 0,
        // A hand-over wins: the passenger isn't asked whether it's solved when it goes to a person.
        resolutionCheck: resolutionCheck && handoverReason == null,
        handoverReason,
      };
    }

    // Passed back unchanged (thinking blocks included), then every result in one message.
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolCalls) {
      // Only lookups are listed (and noted in the history); signals are stored separately.
      if (!SIGNAL_TOOLS.has(call.name)) toolsUsed.push(call.name);
      try {
        const result =
          call.name === 'get_my_rides'
            ? await getMyRides(args.admin, args.userId, args.language)
            : call.name === 'get_my_payments'
              ? await getMyPayments(args.admin, args.userId)
              : SIGNAL_TOOLS.has(call.name)
                ? { done: 'The app will show this to the passenger. Now write your answer.' }
                : null;
        results.push(
          result == null
            ? { type: 'tool_result', tool_use_id: call.id, content: 'Unknown tool.', is_error: true }
            : { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) }
        );
      } catch (err) {
        console.error(`help-chat tool ${call.name} failed`, err);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: 'Could not read this right now.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: '', usage, toolsUsed, refused: true, resolutionCheck: false, handoverReason };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: { action?: unknown; conversationId?: unknown; message?: unknown; language?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: userData } = await admin.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  const user = userData.user;
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const language = parseHelpLanguage(body.language);

  if (body.action === 'start') {
    const { current } = await loadRides(admin, user.id);
    const { data: conversation, error } = await admin
      .from('help_conversations')
      .insert({ user_id: user.id, language, request_id: current?.id ?? null })
      .select('id')
      .single();
    if (error || !conversation) return jsonResponse({ error: 'start_failed' }, 500);
    const { data: greeting } = await admin
      .from('help_messages')
      .insert({ conversation_id: conversation.id, user_id: user.id, role: 'assistant', content: HELP_TEXTS[language].greeting })
      .select('id, role, content, created_at')
      .single();
    return jsonResponse({ conversationId: conversation.id, messages: greeting ? [greeting] : [] });
  }

  // "Did this solve your problem?" - Yes: resolved by the assistant. No: the app starts the
  // handover (support-handover), which records it.
  if (body.action === 'resolve') {
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
    const { data: resolved } = await admin
      .from('help_conversations')
      .update({ resolved_at: new Date().toISOString(), resolved_by: 'assistant' })
      .eq('id', conversationId)
      .eq('user_id', user.id)
      .is('handed_over_at', null)
      .select('id');
    if (!resolved?.length) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ resolved: true });
  }

  if (body.action !== 'send') return jsonResponse({ error: 'invalid_action' }, 400);

  const userText = typeof body.message === 'string' ? sanitizeUserText(body.message) : '';
  if (!userText) return jsonResponse({ error: 'empty_message' }, 400);
  if (userText.length > HELP_MAX_MESSAGE_CHARS) return jsonResponse({ error: 'message_too_long', max: HELP_MAX_MESSAGE_CHARS }, 413);

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
  const { data: conversation } = await admin.from('help_conversations').select('id, user_id').eq('id', conversationId).maybeSingle();
  if (!conversation || conversation.user_id !== user.id) return jsonResponse({ error: 'not_found' }, 404);

  const { count: recent } = await admin
    .from('help_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('role', 'user')
    .gt('created_at', new Date(Date.now() - 60 * 60_000).toISOString());
  if ((recent ?? 0) >= HELP_RATE_LIMIT_PER_HOUR) {
    return jsonResponse({ error: 'rate_limited', limit: HELP_RATE_LIMIT_PER_HOUR }, 429);
  }

  // The history, rebuilt from what was stored (text only), oldest first, starting with the
  // passenger: the fixed greeting is shown in the app but not sent to the model.
  const { data: stored } = await admin
    .from('help_messages')
    .select('role, content, tools_used')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(HELP_HISTORY_MESSAGES);
  const history = (stored ?? []).reverse() as { role: 'user' | 'assistant'; content: string; tools_used: string[] | null }[];
  while (history.length && history[0].role === 'assistant') history.shift();

  const emergency = detectEmergency(userText);
  const texts = HELP_TEXTS[language];

  let reply: string;
  let result: Awaited<ReturnType<typeof answer>> | null = null;
  try {
    result = await answer({
      admin,
      userId: user.id,
      language,
      history: history.map((m) => ({ role: m.role, content: m.role === 'assistant' ? replayedAnswer(m.content, m.tools_used) : m.content })),
      userText,
      emergency,
    });
    reply = result.refused ? texts.refusal : result.text;
  } catch (err) {
    console.error('help-chat model call failed', err);
    // Danger is never left unanswered, even without the model.
    if (!emergency) return jsonResponse({ error: 'assistant_unavailable' }, 503);
    reply = texts.refusal;
  }
  if (emergency) reply = `${texts.emergency}\n\n${reply}`;
  // Danger always offers the team too, even if the model didn't say so.
  const handoverReason = result?.handoverReason ?? (emergency ? 'safety' : null);
  const resolutionCheck = handoverReason == null && result?.resolutionCheck === true;

  const now = new Date().toISOString();
  await admin.from('help_messages').insert({ conversation_id: conversation.id, user_id: user.id, role: 'user', content: userText, created_at: now });
  const { data: saved } = await admin
    .from('help_messages')
    .insert({
      conversation_id: conversation.id,
      user_id: user.id,
      role: 'assistant',
      content: reply.slice(0, 8000),
      // A millisecond later, so the answer always sorts after the question.
      created_at: new Date(Date.parse(now) + 1).toISOString(),
      model: result ? HELP_MODEL : null,
      tools_used: result?.toolsUsed.length ? result.toolsUsed : null,
      emergency,
      resolution_check: resolutionCheck,
      handover_reason: handoverReason,
      input_tokens: result?.usage.input_tokens ?? null,
      output_tokens: result?.usage.output_tokens ?? null,
      cache_read_tokens: result?.usage.cache_read_input_tokens ?? null,
      cache_write_tokens: result?.usage.cache_creation_input_tokens ?? null,
      cost_usd: result ? costUsd(result.usage) : null,
    })
    .select('id, role, content, created_at, resolution_check, handover_reason')
    .single();
  await admin
    .from('help_conversations')
    .update({ last_message_at: now, language, ...(handoverReason ? { handover_reason: handoverReason } : {}) })
    .eq('id', conversation.id);

  return jsonResponse({ message: saved, emergency, resolutionCheck, handoverReason });
});
