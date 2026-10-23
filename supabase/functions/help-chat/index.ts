// The AI support assistant behind "Help" (Claude Haiku 5.5). The Anthropic key lives only in this
// function's secrets, never in the app.
//   { action: 'start', language, fresh? }   -> the conversation to show: the one of a ticket that is
//                                              still open, else the last one if it is less than 24
//                                              hours old, else (or with fresh) a new one. With the
//                                              passenger's first name for the greeting.
//   { action: 'send', conversationId, message, language, stream? }
//                                           -> the answer. With stream, as server-sent events: the
//                                              emergency flag first, then the text as it is written,
//                                              then the stored answer with its cards and buttons.
//   { action: 'resolve', conversationId }   -> "Did this solve your problem?" - Yes.
//   { action: 'feedback', messageId, value, note? } -> thumbs up / down on an answer.
//   { action: 'topic', topic, language }    -> without the AI: the knowledge base section for a
//                                              suggested question (when the assistant is down).
// It answers from the published knowledge base (help_articles) and the passenger's own data, read
// through read-only tools scoped to the signed-in user - it can never change anything, and never
// sees other passengers' data. Cards about the passenger's ride, payment or refund are built here
// from the database, never written by the model. Danger always gets the emergency flag (the app's
// "Call 112" card), even if the model is unreachable. The history comes from help_messages, never
// from the app. Rate limited per user, with a maximum message length.
//
// Deployed with the default JWT verification (any logged-in app user may call this).

import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { sendEmail } from '../_shared/email.ts';
import { CARD_TYPES, CardType, HelpAction, HelpCard, parseHelpAction, paymentCard, PaymentFacts, refundCard, rideCard, RideFacts } from '../_shared/helpCards.ts';
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
  HELP_TOPICS,
  HelpUsage,
  KnowledgeArticle,
  parseHelpLanguage,
  replayedAnswer,
  sanitizeUserText,
  systemPrompt,
} from '../_shared/helpChatRules.ts';
import type { HelpLanguage } from '../_shared/helpKnowledgeBase.ts';
import { HandoverReason, isUrgent, parseHandoverReason } from '../_shared/supportRules.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const RESUME_WITHIN_MS = 24 * 60 * 60_000;

// The tools. Stable order and wording: they are part of the cached prefix.
const EMPTY_SCHEMA = { type: 'object' as const, properties: {}, additionalProperties: false };
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_my_rides',
    description:
      "The signed-in passenger's own rides: the current one (if any) and up to 5 earlier ones, each with its status, its group's status, the meeting point, the meeting time, and whether this passenger pays the taxi. Read-only. Contains nothing about other passengers beyond how many are in the group.",
    input_schema: EMPTY_SCHEMA,
  },
  {
    name: 'get_my_payments',
    description:
      "The signed-in passenger's own payments for their last rides: what is reserved on their card, what was charged and released, what failed or is outstanding, and - when they paid the taxi - the reimbursement to them. Also whether they have a saved card. Read-only. Amounts in euros.",
    input_schema: EMPTY_SCHEMA,
  },
  // Signals for the app - they change nothing.
  {
    name: 'offer_resolution_check',
    description:
      'Call this together with an answer that fully answers the question or gives a complete solution. The app then asks the passenger "Did this solve your problem?". Changes nothing.',
    input_schema: EMPTY_SCHEMA,
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
  {
    name: 'show_card',
    description:
      "Shows a card with the passenger's own data under your answer, built by the app from their real data: 'ride' (destination, time, status, meeting point), 'payment' (the FLOQQ fee and their share, each with its real status) or 'refund' (what was released or refunded). Use it whenever your answer is about their ride, payment or refund, and don't repeat in your text what the card shows.",
    input_schema: {
      type: 'object',
      properties: { type: { type: 'string', enum: [...CARD_TYPES] } },
      required: ['type'],
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_action',
    description:
      "Adds a button under your answer that opens a screen in the app, where the passenger does it themselves: 'open_my_ride', 'edit_ride', 'cancel_ride' (opens My Ride, where they cancel with the usual confirmation), 'payment_methods', 'show_badge' (Find your group), 'location_settings' (the phone's settings for FLOQQ). Nothing happens until they act on that screen.",
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['open_my_ride', 'edit_ride', 'cancel_ride', 'payment_methods', 'show_badge', 'location_settings'] },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
];

const SIGNAL_TOOLS = new Set(['offer_resolution_check', 'hand_over', 'show_card', 'suggest_action']);

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

// What the app shows of a stored message.
const MESSAGE_COLUMNS = 'id, role, content, created_at, emergency, resolution_check, handover_reason, cards, actions, offer_handover, feedback';

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

type Group = {
  status: string;
  meeting_point_id: string | null;
  meeting_time: string | null;
  offer_expires_at: string | null;
  ride_started_at: string | null;
  meetup_completed_at: string | null;
  meetup_flagged_at: string | null;
  completed_at: string | null;
  payer_request_id: string | null;
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
  return { current, earlier: rides.filter((r) => r !== current).slice(0, 5), latest: rides[0] ?? null };
}

async function loadGroup(admin: SupabaseClient, groupId: string | null): Promise<Group | null> {
  if (!groupId) return null;
  const { data } = await admin
    .from('taxi_groups')
    .select('status, meeting_point_id, meeting_time, offer_expires_at, ride_started_at, meetup_completed_at, meetup_flagged_at, completed_at, payer_request_id')
    .eq('id', groupId)
    .maybeSingle();
  return (data as Group | null) ?? null;
}

async function meetingPointName(admin: SupabaseClient, pointId: string | null, language: HelpLanguage): Promise<string | null> {
  if (!pointId) return null;
  const { data: point } = await admin.from('meeting_points').select('short_code, terminal, name_i18n').eq('id', pointId).maybeSingle();
  if (!point) return null;
  const names = (point.name_i18n ?? {}) as Record<string, string>;
  const name = names[language] ?? names.en;
  return name ? `${name} (${point.short_code})` : `${point.short_code} · ${point.terminal}`;
}

// Every time the model sees is Barcelona wall-clock time, like "now" in its context - a raw UTC
// timestamp next to a local "now" made it compare two different clocks.
function local(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function describeRide(admin: SupabaseClient, ride: Ride, language: HelpLanguage) {
  const g = await loadGroup(admin, ride.group_id);
  let group: Record<string, unknown> | null = null;
  if (g) {
    const [{ count }, point] = await Promise.all([
      admin.from('passenger_requests').select('id', { count: 'exact', head: true }).eq('group_id', ride.group_id),
      meetingPointName(admin, g.meeting_point_id, language),
    ]);
    group = {
      group_status: g.status === 'unconfirmed' ? 'match found - waiting for everyone to secure their spot' : g.status,
      passengers_in_group: count ?? null,
      offer_answer_deadline: g.status === 'unconfirmed' ? local(g.offer_expires_at) : null,
      meeting_point: point ? `${point} - the app's meeting point card has the photo and directions` : null,
      meeting_time: local(g.meeting_time),
      group_found_each_other: g.meetup_completed_at != null,
      ride_started: g.ride_started_at != null,
      under_floqq_review_because_group_never_met: g.meetup_flagged_at != null,
      group_ride_completed: g.completed_at != null,
      this_passenger_pays_the_taxi: g.payer_request_id === ride.id,
    };
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
    arrival_time: local(ride.arrival_at),
    ready_at_meeting_point_from: local(ride.ready_at),
    destination: ride.destination_address,
    marked_no_show: ride.no_show_at != null,
    group,
  };
}

async function getMyRides(admin: SupabaseClient, userId: string, language: HelpLanguage) {
  const { current, earlier } = await loadRides(admin, userId);
  return {
    times: 'Barcelona time',
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
    times: 'Barcelona time',
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
      card_charged_after: local(p.charge_at),
      reserve_before: p.payment_status === 'NOT_STARTED' || p.payment_status === 'HOLD_FAILED' ? local(p.hold_deadline_at) : null,
      free_cancellation_until: local(p.free_cancel_until),
      problem: p.failure_reason,
      outstanding: p.outstanding_cents && !p.outstanding_resolved_at ? euros(p.outstanding_cents) : null,
    })),
    reimbursements_to_this_passenger_as_payer: (payouts ?? []).map((p) => ({
      ride: shortId(p.payer_request_id),
      amount: euros(p.amount_cents),
      status: p.status,
      sent_at: local(p.sent_at),
    })),
  };
}

// The cards the assistant asked for, from the passenger's current (or most recent) ride.
async function buildCards(admin: SupabaseClient, userId: string, language: HelpLanguage, types: Set<CardType>): Promise<HelpCard[]> {
  if (types.size === 0) return [];
  const { current, latest } = await loadRides(admin, userId);
  const ride = current ?? latest;
  if (!ride) return [];
  const group = await loadGroup(admin, ride.group_id);
  const cards: HelpCard[] = [];
  if (types.has('ride')) {
    const facts: RideFacts = {
      status: ride.status,
      destination: ride.destination_address,
      arrivalAt: ride.arrival_at,
      completedAt: ride.completed_at,
      group: group
        ? {
            status: group.status,
            meetingTime: group.meeting_time,
            rideStartedAt: group.ride_started_at,
            meetingPoint: await meetingPointName(admin, group.meeting_point_id, language),
          }
        : null,
    };
    cards.push(rideCard(facts));
  }
  if (types.has('payment') || types.has('refund')) {
    const { data: row } = await admin
      .from('ride_payments')
      .select('payment_status, platform_fee_cents, estimated_share_cents, final_share_cents, hold_amount_cents, captured_cents, released_cents, captured_at, released_at')
      .eq('user_id', userId)
      .eq('request_id', ride.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const facts: PaymentFacts | null = row ? { ...row, isPayer: group?.payer_request_id === ride.id } : null;
    if (types.has('payment') && facts) cards.push(paymentCard(facts));
    if (types.has('refund')) cards.push(refundCard(facts));
  }
  return cards;
}

// "Talk to the team" offered at once: the passenger is at the airport (about to meet their group,
// on the way, or just arrived) - no waiting for "Did this solve your problem?".
async function atTheAirport(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { current, latest } = await loadRides(admin, userId);
  const ride = current ?? latest;
  if (!ride) return false;
  const group = await loadGroup(admin, ride.group_id);
  const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);
  return isUrgent(
    {
      groupStatus: group?.status ?? null,
      meetingMs: ms(group?.meeting_time) ?? ms(ride.ready_at ?? ride.arrival_at),
      rideStartedMs: ms(group?.ride_started_at),
      groupCompletedMs: ms(group?.completed_at),
      rideCompletedMs: ms(ride.completed_at),
    },
    Date.now()
  );
}

type Answer = {
  text: string;
  usage: HelpUsage;
  toolsUsed: string[];
  refused: boolean;
  resolutionCheck: boolean;
  handoverReason: HandoverReason | null;
  cardTypes: Set<CardType>;
  actions: HelpAction[];
};

// Asks the model, running its read-only tools as often as it needs (within limits). With onText,
// the answer's text is passed on as it is written.
// What every answer reads before the model starts, fetched side by side so the first words come
// quickly: the published knowledge base, the conversation so far, and the passenger's current ride.
async function prepare(admin: SupabaseClient, userId: string, conversationId: string, language: HelpLanguage) {
  const [articles, stored, currentRide] = await Promise.all([
    admin.from('help_articles').select('section_key, language, sort_order, title, content, status').eq('status', 'published'),
    admin
      .from('help_messages')
      .select('role, content, tools_used')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(HELP_HISTORY_MESSAGES),
    loadRides(admin, userId).then(({ current }) => (current ? describeRide(admin, current, language).then((d) => JSON.stringify(d)) : 'none')),
  ]);
  // The history, rebuilt from what was stored (text only), oldest first, starting with the passenger.
  const history = ((stored.data ?? []) as { role: 'user' | 'assistant'; content: string; tools_used: string[] | null }[]).reverse();
  while (history.length && history[0].role === 'assistant') history.shift();
  return {
    articles: (articles.data ?? []) as KnowledgeArticle[],
    history: history.map((m): Anthropic.MessageParam => ({ role: m.role, content: m.role === 'assistant' ? replayedAnswer(m.content, m.tools_used) : m.content })),
    currentRide,
  };
}

async function answer(args: {
  admin: SupabaseClient;
  userId: string;
  language: HelpLanguage;
  articles: KnowledgeArticle[];
  history: Anthropic.MessageParam[];
  currentRide: string;
  userText: string;
  emergency: boolean;
  onText?: (text: string) => void;
  onReset?: () => void;
}): Promise<Answer> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt(args.articles, args.language), cache_control: { type: 'ephemeral' } },
  ];
  const context = appContext({
    language: args.language,
    nowIso: new Date().toISOString(),
    currentRide: args.currentRide,
    emergencyLineShown: args.emergency,
  });
  const messages: Anthropic.MessageParam[] = [
    ...args.history,
    { role: 'user', content: [{ type: 'text', text: context }, { type: 'text', text: args.userText }] },
  ];

  const result: Answer = {
    text: '',
    usage: { input_tokens: 0, output_tokens: 0 },
    toolsUsed: [],
    refused: false,
    resolutionCheck: false,
    handoverReason: null,
    cardTypes: new Set(),
    actions: [],
  };
  const texts: string[] = [];

  for (let round = 0; round <= HELP_MAX_TOOL_ROUNDS; round += 1) {
    const params = {
      model: HELP_MODEL,
      max_tokens: 2048,
      // No thinking step: the first words have to come within about a second and a half, and the
      // answers are short lookups in a known text (checked by scripts/help-eval-test.mjs).
      thinking: { type: 'disabled' as const },
      output_config: { effort: 'low' as const },
      system,
      tools: TOOLS,
      // On the last round it must answer with what it has.
      tool_choice: round === HELP_MAX_TOOL_ROUNDS ? { type: 'none' as const } : { type: 'auto' as const },
      messages,
    };
    let response: Anthropic.Message;
    if (args.onText) {
      // A space keeps two rounds' text apart.
      let first = true;
      const stream = client.messages.stream(params);
      stream.on('text', (delta) => {
        if (first && texts.length) args.onText!(' ');
        first = false;
        args.onText!(delta);
      });
      response = await stream.finalMessage();
    } else {
      response = await client.messages.create(params);
    }
    result.usage = addUsage(result.usage, response.usage);

    if (response.stop_reason === 'refusal') return { ...result, text: '', refused: true, resolutionCheck: false };

    const toolCalls = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    for (const call of toolCalls) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      if (call.name === 'offer_resolution_check') result.resolutionCheck = true;
      if (call.name === 'hand_over') result.handoverReason = parseHandoverReason(input.reason);
      if (call.name === 'show_card' && CARD_TYPES.includes(input.type as CardType)) result.cardTypes.add(input.type as CardType);
      if (call.name === 'suggest_action') {
        const action = parseHelpAction(input.action);
        if (action && !result.actions.includes(action)) result.actions.push(action);
      }
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (text) texts.push(text);

    // Done: no tool to run, or only signals next to an answer that is already written.
    const onlySignals = toolCalls.every((call) => SIGNAL_TOOLS.has(call.name));
    if (response.stop_reason !== 'tool_use' || toolCalls.length === 0 || (onlySignals && text)) {
      result.text = texts.join(' ').trim();
      result.refused = result.text.length === 0;
      // A hand-over wins: the passenger isn't asked whether it's solved when it goes to a person.
      if (result.handoverReason) result.resolutionCheck = false;
      // An answer based on their own data always shows that data, even if the model didn't ask.
      if (result.cardTypes.size === 0) {
        if (result.toolsUsed.includes('get_my_payments')) result.cardTypes.add('payment');
        else if (result.toolsUsed.includes('get_my_rides')) result.cardTypes.add('ride');
      }
      return result;
    }

    // Text written before a lookup ("Let me check...", or a first answer it then rewrites with the
    // real data) is dropped: the answer after the lookup replaces it, on screen too.
    if (text && !onlySignals) {
      texts.length = 0;
      args.onReset?.();
    }

    // Passed back unchanged (thinking blocks included), then every result in one message.
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolCalls) {
      // Only lookups are listed (and noted in the history); signals are stored separately.
      if (!SIGNAL_TOOLS.has(call.name)) result.toolsUsed.push(call.name);
      try {
        const output =
          call.name === 'get_my_rides'
            ? await getMyRides(args.admin, args.userId, args.language)
            : call.name === 'get_my_payments'
              ? await getMyPayments(args.admin, args.userId)
              : SIGNAL_TOOLS.has(call.name)
                ? { done: 'The app will show this to the passenger. Now write your answer.' }
                : null;
        results.push(
          output == null
            ? { type: 'tool_result', tool_use_id: call.id, content: 'Unknown tool.', is_error: true }
            : { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output) }
        );
      } catch (err) {
        console.error(`help-chat tool ${call.name} failed`, err);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: 'Could not read this right now.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { ...result, text: texts.join(' ').trim(), refused: texts.length === 0 };
}

// A message in a conversation the team is handling goes in the ticket's history. After "We tried
// to call you" it is the passenger's answer: the ticket goes back to open and the team hears of it.
async function notePassengerReply(admin: SupabaseClient, conversationId: string, text: string) {
  const { data: ticket } = await admin
    .from('support_tickets')
    .select('id, reference, status, urgent')
    .eq('conversation_id', conversationId)
    .neq('status', 'resolved')
    .maybeSingle();
  if (!ticket) return;
  await admin.from('support_ticket_events').insert({ ticket_id: ticket.id, kind: 'passenger_replied', body: text.slice(0, 2000) });
  if (ticket.status !== 'no_answer') return;
  await admin.from('support_tickets').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', ticket.id);
  const { data: settings } = await admin.from('support_settings').select('alert_email').eq('id', 1).maybeSingle();
  if (settings?.alert_email) {
    await sendEmail({
      to: settings.alert_email,
      subject: `${ticket.urgent ? 'URGENT - ' : ''}Ticket #${ticket.reference}: the passenger replied`,
      text: `We couldn't reach the passenger of ticket #${ticket.reference} by phone; they have now replied in the help chat:\n\n${text.slice(0, 2000)}\n\nOpen the FLOQQ admin to see the conversation.`,
    });
  }
}

async function firstName(admin: SupabaseClient, user: { id: string; user_metadata?: Record<string, unknown> }): Promise<string | null> {
  const { data } = await admin.from('profiles').select('first_name').eq('user_id', user.id).maybeSingle();
  const name = (data?.first_name as string | undefined) ?? (user.user_metadata?.first_name as string | undefined);
  return name?.trim() ? name.trim().slice(0, 40) : null;
}

type SendOutcome = { status: number; body: Record<string, unknown> };

// The answer to one message: everything but how it is delivered (JSON or a stream).
async function send(args: {
  admin: SupabaseClient;
  userId: string;
  conversationId: string;
  userText: string;
  language: HelpLanguage;
  emergency: boolean;
  onText?: (text: string) => void;
  onReset?: () => void;
}): Promise<SendOutcome> {
  const { admin, userId, conversationId, userText, language, emergency } = args;

  const texts = HELP_TEXTS[language];
  let reply: string;
  let result: Answer | null = null;
  try {
    const prepared = await prepare(admin, userId, conversationId, language);
    result = await answer({ admin, userId, language, ...prepared, userText, emergency, onText: args.onText, onReset: args.onReset });
    reply = result.refused ? texts.refusal : result.text;
  } catch (err) {
    console.error('help-chat model call failed', err);
    // Danger is never left unanswered, even without the model: the app shows "Call 112".
    if (!emergency) return { status: 503, body: { error: 'assistant_unavailable' } };
    reply = texts.refusal;
  }

  // Danger always offers the team too, even if the model didn't say so.
  const handoverReason = result?.handoverReason ?? (emergency ? 'safety' : null);
  const resolutionCheck = handoverReason == null && result?.resolutionCheck === true;
  const [airport, cards] = await Promise.all([
    handoverReason == null && !emergency ? atTheAirport(admin, userId) : Promise.resolve(false),
    result ? buildCards(admin, userId, language, result.cardTypes) : Promise.resolve([] as HelpCard[]),
  ]);
  const offerHandover = handoverReason == null && (emergency || airport);

  const now = new Date().toISOString();
  await admin.from('help_messages').insert({ conversation_id: conversationId, user_id: userId, role: 'user', content: userText, created_at: now });
  const { data: saved } = await admin
    .from('help_messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role: 'assistant',
      content: reply.slice(0, 8000),
      // A millisecond later, so the answer always sorts after the question.
      created_at: new Date(Date.parse(now) + 1).toISOString(),
      model: result ? HELP_MODEL : null,
      tools_used: result?.toolsUsed.length ? result.toolsUsed : null,
      emergency,
      resolution_check: resolutionCheck,
      handover_reason: handoverReason,
      offer_handover: offerHandover,
      cards: cards.length ? cards : null,
      actions: result?.actions.length ? result.actions : null,
      input_tokens: result?.usage.input_tokens ?? null,
      output_tokens: result?.usage.output_tokens ?? null,
      cache_read_tokens: result?.usage.cache_read_input_tokens ?? null,
      cache_write_tokens: result?.usage.cache_creation_input_tokens ?? null,
      cost_usd: result ? costUsd(result.usage) : null,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  await admin
    .from('help_conversations')
    .update({ last_message_at: now, language, ...(handoverReason ? { handover_reason: handoverReason } : {}) })
    .eq('id', conversationId);
  await notePassengerReply(admin, conversationId, userText);

  return { status: 200, body: { message: saved, emergency, resolutionCheck, handoverReason, offerHandover } };
}

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

  const language = parseHelpLanguage(body.language);

  if (body.action === 'start') {
    const name = await firstName(admin, user);
    const loadMessages = async (conversationId: string) =>
      (
        await admin
          .from('help_messages')
          .select(MESSAGE_COLUMNS)
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true })
          .limit(300)
      ).data ?? [];

    // With a ticket still open, the passenger comes back to that conversation: what they write
    // there is what the team reads.
    const { data: openTicket } = await admin
      .from('support_tickets')
      .select('conversation_id')
      .eq('user_id', user.id)
      .neq('status', 'resolved')
      .not('conversation_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openTicket?.conversation_id) {
      return jsonResponse({ conversationId: openTicket.conversation_id, messages: await loadMessages(openTicket.conversation_id), firstName: name, resumed: true });
    }
    // Back within 24 hours: the last conversation continues, unless they asked for a new one.
    if (body.fresh !== true) {
      const { data: recent } = await admin
        .from('help_conversations')
        .select('id, last_message_at')
        .eq('user_id', user.id)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recent && Date.now() - Date.parse(recent.last_message_at) < RESUME_WITHIN_MS) {
        return jsonResponse({ conversationId: recent.id, messages: await loadMessages(recent.id), firstName: name, resumed: true });
      }
    }
    const { current } = await loadRides(admin, user.id);
    const { data: conversation, error } = await admin
      .from('help_conversations')
      .insert({ user_id: user.id, language, request_id: current?.id ?? null })
      .select('id')
      .single();
    if (error || !conversation) return jsonResponse({ error: 'start_failed' }, 500);
    return jsonResponse({ conversationId: conversation.id, messages: [], firstName: name, resumed: false });
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

  // Thumbs up or down under an answer (null takes it back), with an optional "What was missing?".
  if (body.action === 'feedback') {
    const value = body.value === 'up' || body.value === 'down' ? body.value : null;
    const note = value === 'down' && typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    const { data: updated } = await admin
      .from('help_messages')
      .update({ feedback: value, feedback_note: note, feedback_at: value ? new Date().toISOString() : null })
      .eq('id', typeof body.messageId === 'string' ? body.messageId : '')
      .eq('user_id', user.id)
      .eq('role', 'assistant')
      .select('id');
    if (!updated?.length) return jsonResponse({ error: 'not_found' }, 404);
    return jsonResponse({ ok: true });
  }

  // Without the AI: the knowledge base's answer to a suggested question.
  if (body.action === 'topic') {
    const sectionKey = HELP_TOPICS[String(body.topic) as keyof typeof HELP_TOPICS];
    if (!sectionKey) return jsonResponse({ error: 'unknown_topic' }, 400);
    const { data: articles } = await admin
      .from('help_articles')
      .select('language, title, content')
      .eq('section_key', sectionKey)
      .eq('status', 'published')
      .in('language', [language, 'en']);
    const article = (articles ?? []).find((a) => a.language === language) ?? (articles ?? []).find((a) => a.language === 'en');
    if (!article) return jsonResponse({ error: 'unknown_topic' }, 404);
    return jsonResponse({ title: article.title, content: article.content });
  }

  if (body.action !== 'send') return jsonResponse({ error: 'invalid_action' }, 400);

  const userText = typeof body.message === 'string' ? sanitizeUserText(body.message) : '';
  if (!userText) return jsonResponse({ error: 'empty_message' }, 400);
  if (userText.length > HELP_MAX_MESSAGE_CHARS) return jsonResponse({ error: 'message_too_long', max: HELP_MAX_MESSAGE_CHARS }, 413);

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
  const [{ data: conversation }, { count: recent }] = await Promise.all([
    admin.from('help_conversations').select('id, user_id').eq('id', conversationId).maybeSingle(),
    admin
      .from('help_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('role', 'user')
      .gt('created_at', new Date(Date.now() - 60 * 60_000).toISOString()),
  ]);
  if (!conversation || conversation.user_id !== user.id) return jsonResponse({ error: 'not_found' }, 404);
  if ((recent ?? 0) >= HELP_RATE_LIMIT_PER_HOUR) {
    return jsonResponse({ error: 'rate_limited', limit: HELP_RATE_LIMIT_PER_HOUR }, 429);
  }

  const emergency = detectEmergency(userText);
  const base = { admin, userId: user.id, conversationId: conversation.id, userText, language, emergency };

  if (body.stream !== true) {
    const outcome = await send(base);
    return jsonResponse(outcome.body, outcome.status);
  }

  // Streamed: "emergency" straight away (the app shows "Call 112" before any text), then the text
  // as it is written, then the stored answer.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const event = (data: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      event({ type: 'start', emergency });
      try {
        const outcome = await send({ ...base, onText: (text) => event({ type: 'delta', text }), onReset: () => event({ type: 'reset' }) });
        event(outcome.status === 200 ? { type: 'done', ...outcome.body } : { type: 'error', error: outcome.body.error });
      } catch (err) {
        console.error('help-chat stream failed', err);
        event({ type: 'error', error: 'assistant_unavailable' });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
});
