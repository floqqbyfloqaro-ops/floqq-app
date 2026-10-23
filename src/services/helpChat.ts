import { fetch as streamingFetch } from 'expo/fetch';

import type { HelpTopic } from './helpChips';
import { supabase } from './supabase';

// The AI help assistant (supabase/functions/help-chat) and the handover to the FLOQQ team
// (supabase/functions/support-handover). The app never talks to the AI directly and never holds
// the conversation's history itself: both functions read it from the server. Answers are streamed
// with Expo's fetch (React Native's own can't read a response as it arrives).

export type HelpLanguage = 'en' | 'fr' | 'es';

export type CardStatus = 'paid' | 'pending' | 'refunded' | 'released' | 'failed' | 'paid_to_taxi';
export type HelpCard =
  | { type: 'ride'; destination: string; at: string; status: 'searching' | 'match_found' | 'confirmed' | 'on_the_way' | 'completed' | 'cancelled' | 'expired'; meetingPoint: string | null }
  | { type: 'payment'; lines: { kind: 'fee' | 'share'; amountCents: number | null; status: CardStatus; date: string | null }[] }
  | { type: 'refund'; amountCents: number | null; status: 'released' | 'refunded' | 'pending' | 'none'; date: string | null };

export type HelpAction = 'open_my_ride' | 'edit_ride' | 'cancel_ride' | 'payment_methods' | 'show_badge' | 'location_settings';

export type HelpMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  emergency?: boolean;
  // Set on an assistant answer: ask "Did this solve your problem?", go to the team, or offer the
  // team right away (at the airport, or danger).
  resolution_check?: boolean;
  handover_reason?: string | null;
  offer_handover?: boolean;
  cards?: HelpCard[] | null;
  actions?: HelpAction[] | null;
  feedback?: 'up' | 'down' | null;
};

export const helpLanguageFor = (language: string): HelpLanguage => (language.startsWith('fr') ? 'fr' : language.startsWith('es') ? 'es' : 'en');

async function errorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.json !== 'function') return null;
  const body = await context.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : null;
}

// fresh: a new conversation even if the last one is less than a day old.
export async function startHelpConversation(language: HelpLanguage, fresh = false) {
  const { data, error } = await supabase.functions.invoke('help-chat', { body: { action: 'start', language, fresh } });
  if (error || !data?.conversationId) {
    return { conversationId: null as string | null, messages: [] as HelpMessage[], firstName: null as string | null, error: (await errorCode(error)) ?? 'start_failed' };
  }
  return {
    conversationId: data.conversationId as string,
    messages: (data.messages ?? []) as HelpMessage[],
    firstName: (data.firstName ?? null) as string | null,
    error: null,
  };
}

export type HelpAnswer = {
  message: HelpMessage;
  emergency: boolean;
  resolutionCheck: boolean;
  handoverReason: string | null;
  offerHandover: boolean;
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

// "Did this solve your problem?" -> Yes.
export async function markHelpResolved(conversationId: string) {
  const { error } = await supabase.functions.invoke('help-chat', { body: { action: 'resolve', conversationId } });
  return { error: error ? ((await errorCode(error)) ?? 'resolve_failed') : null };
}

// Thumbs up / down under an answer; null takes it back.
export async function sendHelpFeedback(messageId: string, value: 'up' | 'down' | null, note?: string) {
  const { error } = await supabase.functions.invoke('help-chat', { body: { action: 'feedback', messageId, value, note } });
  return { error: error ? ((await errorCode(error)) ?? 'feedback_failed') : null };
}

// Without the AI: the knowledge base's answer to a suggested question.
export async function fetchHelpTopic(topic: HelpTopic, language: HelpLanguage) {
  const { data, error } = await supabase.functions.invoke('help-chat', { body: { action: 'topic', topic, language } });
  if (error || !data?.content) return { article: null as { title: string; content: string } | null };
  return { article: data as { title: string; content: string } };
}

export type CallbackSlot = { at: string; day: 'today' | 'tomorrow'; time: string };

export type SupportInfo = {
  teamLanguages: HelpLanguage[];
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
  language: HelpLanguage;
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
