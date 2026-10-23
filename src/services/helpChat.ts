import { supabase } from './supabase';

// The AI help assistant (supabase/functions/help-chat) and the handover to the FLOQQ team
// (supabase/functions/support-handover). The app never talks to the AI directly and never holds
// the conversation's history itself: both functions read it from the server.

export type HelpLanguage = 'en' | 'fr' | 'es';

export type HelpMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  // Set on an assistant answer: ask "Did this solve your problem?", or go to the team.
  resolution_check?: boolean;
  handover_reason?: string | null;
};

export const helpLanguageFor = (language: string): HelpLanguage => (language.startsWith('fr') ? 'fr' : language.startsWith('es') ? 'es' : 'en');

async function errorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response } | null)?.context;
  if (!context || typeof context.json !== 'function') return null;
  const body = await context.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : null;
}

export async function startHelpConversation(language: HelpLanguage) {
  const { data, error } = await supabase.functions.invoke('help-chat', { body: { action: 'start', language } });
  if (error || !data?.conversationId) return { conversationId: null as string | null, messages: [] as HelpMessage[], error: await errorCode(error) ?? 'start_failed' };
  return { conversationId: data.conversationId as string, messages: (data.messages ?? []) as HelpMessage[], error: null };
}

export type HelpAnswer = {
  message: HelpMessage;
  emergency: boolean;
  resolutionCheck: boolean;
  handoverReason: string | null;
};

// error: 'rate_limited' | 'message_too_long' | 'assistant_unavailable' | ...
export async function sendHelpMessage(conversationId: string, message: string, language: HelpLanguage) {
  const { data, error } = await supabase.functions.invoke('help-chat', { body: { action: 'send', conversationId, message, language } });
  if (error || !data?.message) return { answer: null as HelpAnswer | null, error: (await errorCode(error)) ?? 'send_failed' };
  return { answer: data as HelpAnswer, error: null };
}

// "Did this solve your problem?" -> Yes.
export async function markHelpResolved(conversationId: string) {
  const { error } = await supabase.functions.invoke('help-chat', { body: { action: 'resolve', conversationId } });
  return { error: error ? ((await errorCode(error)) ?? 'resolve_failed') : null };
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
