import { fetch as streamingFetch } from 'expo/fetch';

import type { HelpTopic } from './helpChips';
import { supabase } from './supabase';

// The AI help assistant (supabase/functions/help-chat) and the handover to the FLOQQ team
// (supabase/functions/support-handover). The app never talks to the AI directly and never holds
// the conversation's history itself: both functions read it from the server. Answers are streamed
// with Expo's fetch (React Native's own can't read a response as it arrives).

export type HelpLanguage = 'en' | 'fr' | 'es';

export type CardStatus = 'paid' | 'pending' | 'refunded' | 'released' | 'failed' | 'paid_to_taxi';

// What cancelling does to the passenger's money - the same cases as the app's cancel screens
// (supabase/functions/_shared/helpActions.ts).
export type CancelConsequence =
  | { kind: 'searching' }
  | { kind: 'free'; releasedCents: number }
  | { kind: 'fee_kept'; feeCents: number; releasedCents: number }
  | { kind: 'no_charge' };
export type ActionStatus = 'pending' | 'done' | 'kept' | 'failed';
export type ConfirmCard =
  | { type: 'confirm_cancel'; actionId: string; status: ActionStatus; destination: string; at: string; rideStatus: 'searching' | 'grouped'; consequence: CancelConsequence }
  | { type: 'confirm_email_resend'; actionId: string; status: ActionStatus; email: string };

export type HelpCard =
  | { type: 'ride'; destination: string; at: string; status: 'searching' | 'match_found' | 'confirmed' | 'on_the_way' | 'completed' | 'cancelled' | 'expired'; meetingPoint: string | null }
  | { type: 'payment'; lines: { kind: 'fee' | 'share'; amountCents: number | null; status: CardStatus; date: string | null }[] }
  | { type: 'refund'; amountCents: number | null; status: 'released' | 'refunded' | 'pending' | 'none'; date: string | null }
  | ConfirmCard;

export const isConfirmCard = (card: HelpCard): card is ConfirmCard => card.type === 'confirm_cancel' || card.type === 'confirm_email_resend';

export type HelpAction = 'open_my_ride' | 'edit_ride' | 'cancel_ride' | 'payment_methods' | 'show_badge' | 'location_settings';

export type HelpMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  emergency?: boolean;
  // Set on an assistant answer: it asked once whether the passenger is done ('question': "Anything
  // else I can help with?", 'problem': "Did that solve it?") - the app shows the two answers - or
  // it goes to the team.
  followup?: 'question' | 'problem' | null;
  handover_reason?: string | null;
  cards?: HelpCard[] | null;
  actions?: HelpAction[] | null;
};

// How a conversation stands (supabase/migrations/20261027000000_help_conversation_states.sql).
// Every state but active and handed_over is archived and read-only.
export type HelpConversationState = 'active' | 'resolved_by_assistant' | 'handed_over' | 'resolved_by_team' | 'closed_no_reply';

export type HelpConversation = {
  id: string;
  state: HelpConversationState;
  // "Refund for ride of 24 Oct" - from the assistant, else the first message.
  title: string | null;
  created_at: string;
  closed_at: string | null;
  previous_conversation_id: string | null;
  // "Was this helpful?", once.
  helpful: 'up' | 'down' | null;
  request_id: string | null;
};

export const isArchived = (state: HelpConversationState | null | undefined) =>
  state === 'resolved_by_assistant' || state === 'resolved_by_team' || state === 'closed_no_reply';
export const isResolved = (state: HelpConversationState | null | undefined) => state === 'resolved_by_assistant' || state === 'resolved_by_team';

// "Talk to a person": the team also replies in Italian and Dutch (the app itself is en/fr/es).
export const TEAM_LANGUAGES = ['en', 'fr', 'es', 'it', 'nl'] as const;
export type TeamLanguage = (typeof TEAM_LANGUAGES)[number];

export const helpLanguageFor = (language: string): HelpLanguage => (language.startsWith('fr') ? 'fr' : language.startsWith('es') ? 'es' : 'en');

async function errorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.json !== 'function') return null;
  const body = await context.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : null;
}

// fresh: a new conversation even if the last one is still going. previousConversationId: "I still
// need help with this" - a new conversation linked to that one, so the assistant knows it.
export async function startHelpConversation(language: HelpLanguage, options: { fresh?: boolean; previousConversationId?: string } = {}) {
  const { data, error } = await supabase.functions.invoke('help-chat', { body: { action: 'start', language, ...options } });
  if (error || !data?.conversationId) {
    return {
      conversationId: null as string | null,
      conversation: null as HelpConversation | null,
      messages: [] as HelpMessage[],
      firstName: null as string | null,
      error: (await errorCode(error)) ?? 'start_failed',
    };
  }
  return {
    conversationId: data.conversationId as string,
    conversation: (data.conversation ?? null) as HelpConversation | null,
    messages: (data.messages ?? []) as HelpMessage[],
    firstName: (data.firstName ?? null) as string | null,
    error: null,
  };
}

// "Your requests": one archived conversation, to read.
export async function openHelpConversation(conversationId: string) {
  const { data, error } = await supabase.functions.invoke('help-chat', { body: { action: 'open', conversationId } });
  if (error || !data?.conversation) return { conversation: null as HelpConversation | null, messages: [] as HelpMessage[] };
  return { conversation: data.conversation as HelpConversation, messages: (data.messages ?? []) as HelpMessage[] };
}

export type HelpAnswer = {
  message: HelpMessage;
  // The conversation after this answer: still going, resolved ("merci, c'est parfait"), ...
  conversation: HelpConversation | null;
  emergency: boolean;
  handoverReason: string | null;
};

// Sends a message and streams the answer: onEmergency as soon as the server knows (the "Call 112"
// card comes before any text), onText for each piece of text, onReset when the text so far is
// replaced (it looked something up and writes the answer again). error: 'offline' (it never reached
// the server - safe to send again), 'rate_limited', 'message_too_long', 'assistant_unavailable', ...
export async function sendHelpMessageStreamed(
  conversationId: string,
  message: string,
  language: HelpLanguage,
  handlers: { onEmergency?: () => void; onText?: (text: string) => void; onReset?: () => void }
): Promise<{ answer: HelpAnswer | null; error: string | null }> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return { answer: null, error: 'send_failed' };

  let response: Awaited<ReturnType<typeof streamingFetch>>;
  try {
    response = await streamingFetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/help-chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'send', conversationId, message, language, stream: true }),
    });
  } catch {
    return { answer: null, error: 'offline' };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return { answer: null, error: typeof body?.error === 'string' ? body.error : 'send_failed' };
  }

  const reader = response.body?.getReader();
  if (!reader) return { answer: null, error: 'send_failed' };
  const decoder = new TextDecoder();
  let buffer = '';
  let answer: HelpAnswer | null = null;
  let error: string | null = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === 'start' && event.emergency) handlers.onEmergency?.();
        else if (event.type === 'delta') handlers.onText?.(event.text);
        else if (event.type === 'reset') handlers.onReset?.();
        else if (event.type === 'done') answer = event as HelpAnswer;
        else if (event.type === 'error') error = event.error;
      }
    }
  } catch {
    // The connection dropped mid-answer: the server still stores it; the screen reloads it.
    return { answer: null, error: 'interrupted' };
  }
  return answer ? { answer, error: null } : { answer: null, error: error ?? 'send_failed' };
}

// "No, that's all" / "Yes, it's solved": the closing, and the conversation is resolved.
export async function resolveHelpConversation(conversationId: string, language: HelpLanguage) {
  const { data, error } = await supabase.functions.invoke('help-chat', { body: { action: 'resolve', conversationId, language } });
  if (error || !data?.conversation) return { conversation: null as HelpConversation | null, message: null as HelpMessage | null, error: (await errorCode(error)) ?? 'resolve_failed' };
  return { conversation: data.conversation as HelpConversation, message: (data.message ?? null) as HelpMessage | null, error: null };
}

// A tap on a confirmation card: 'confirm' does it ("Cancel my ride" / "Resend email") through the
// same server code as the app's own buttons; 'keep' leaves everything as it is. Returns what the
// assistant says about it, the card's new state and the conversation.
export async function decideHelpAction(actionId: string, decision: 'confirm' | 'keep', language: HelpLanguage) {
  const { data, error } = await supabase.functions.invoke('help-chat', { body: { action: 'decide', actionId, decision, language } });
  if (error || !data?.message) {
    return { message: null as HelpMessage | null, card: null as { messageId: string; cards: HelpCard[] } | null, conversation: null as HelpConversation | null, error: (await errorCode(error)) ?? 'decide_failed' };
  }
  return {
    message: data.message as HelpMessage,
    card: (data.card ?? null) as { messageId: string; cards: HelpCard[] } | null,
    conversation: (data.conversation ?? null) as HelpConversation | null,
    error: null,
  };
}

// "Was this helpful?" on the closing card - once per conversation.
export async function rateHelpConversation(conversationId: string, value: 'up' | 'down') {
  const { error } = await supabase.functions.invoke('help-chat', { body: { action: 'rate', conversationId, value } });
  return { error: error ? ((await errorCode(error)) ?? 'rate_failed') : null };
}

export type HelpRequest = HelpConversation & {
  last_message_at: string;
  // The ride it was about, if any.
  ride: { arrival_at: string; destination_address: string } | null;
};

// "Your requests": the passenger's own conversations that have something in them, newest first
// (row level security: only their own). Open tickets are put on top by the screen.
export async function fetchMyHelpRequests(): Promise<HelpRequest[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from('help_conversations')
    .select('id, state, title, created_at, closed_at, last_message_at, previous_conversation_id, helpful, request_id, ride:passenger_requests(arrival_at, destination_address), help_messages!inner(id)')
    .eq('user_id', user.id)
    .order('last_message_at', { ascending: false })
    .limit(1, { foreignTable: 'help_messages' })
    .limit(30);
  return ((data ?? []) as unknown as (HelpRequest & { help_messages?: unknown })[]).map(({ help_messages: _messages, ...request }) => request);
}

// Without the AI: the knowledge base's answer to a suggested question.
export async function fetchHelpTopic(topic: HelpTopic, language: HelpLanguage) {
  const { data, error } = await supabase.functions.invoke('help-chat', { body: { action: 'topic', topic, language } });
  if (error || !data?.content) return { article: null as { title: string; content: string } | null };
  return { article: data as { title: string; content: string } };
}

export type CallbackSlot = { at: string; day: 'today' | 'tomorrow'; time: string };

export type SupportInfo = {
  teamLanguages: TeamLanguage[];
  openNow: boolean;
  nextOpenAt: string | null;
  whatsapp: boolean;
  callbackSlots: CallbackSlot[];
  // The conversation was about danger: "call 112" comes first.
  emergency: boolean;
  existingTicket: { reference: string; channel: 'whatsapp' | 'callback'; callback_at: string | null; status: string } | null;
};

export async function fetchSupportInfo(conversationId: string) {
  const { data, error } = await supabase.functions.invoke('support-handover', { body: { action: 'info', conversationId } });
  if (error || !data) return { info: null as SupportInfo | null, error: (await errorCode(error)) ?? 'info_failed' };
  return { info: data as SupportInfo, error: null };
}

export type TicketRequest = {
  conversationId: string;
  reason: string;
  language: TeamLanguage;
  channel: 'whatsapp' | 'callback';
  // E.164, call back only.
  phone?: string;
  // null: as soon as possible.
  callbackAt?: string | null;
  consent?: boolean;
};

export type CreatedTicket = {
  reference: string;
  channel: 'whatsapp' | 'callback';
  callbackAt: string | null;
  urgent: boolean;
  whatsapp: { digits: string; text: string } | null;
};

// error: 'invalid_phone' | 'consent_required' | 'invalid_callback_time' | 'whatsapp_unavailable' | ...
export async function createSupportTicket(request: TicketRequest) {
  const { data, error } = await supabase.functions.invoke('support-handover', { body: { action: 'create', ...request } });
  if (error || !data?.reference) return { ticket: null as CreatedTicket | null, error: (await errorCode(error)) ?? 'ticket_failed' };
  return { ticket: data as CreatedTicket, error: null };
}
