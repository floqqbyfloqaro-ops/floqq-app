import { supabase } from './supabase';

// The help assistant's figures for the admin (admin_help_metrics in
// supabase/migrations/20261027000000_help_conversation_states.sql), and the support settings the
// admin edits.

export type HelpMetrics = {
  conversations: number;
  resolved_by_assistant: number;
  resolved_by_team: number;
  closed_no_reply: number;
  // Asked for a person within 24 hours of a conversation the assistant closed as resolved.
  person_after_resolved: number;
  handed_over: number;
  handover_reasons: Record<string, number>;
  channels: Record<string, number>;
  avg_minutes_to_first_contact: number | null;
  open_urgent_tickets: number;
  open_tickets: number;
  thumbs_up: number;
  thumbs_down: number;
  ai_cost_usd: number;
  // "Was this helpful?" -> no: the conversation's title (answer) and its first question.
  thumbs_down_answers: { at: string; answer: string; note: string | null; question: string | null }[];
};

export async function fetchHelpMetrics(fromIso: string) {
  const { data, error } = await supabase.rpc('admin_help_metrics', { p_from: fromIso });
  return { metrics: (data ?? null) as HelpMetrics | null, error };
}

// Share of a whole, as a whole percentage (null when there is nothing to count yet).
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export type SupportSettings = {
  whatsapp_number: string | null;
  team_languages: string[];
  alert_email: string | null;
  retention_days: number;
  // A complete answer with no reply for this long: the conversation is closed (closed_no_reply).
  no_reply_close_minutes: number;
};

export function fetchSupportSettings() {
  return supabase
    .from('support_settings')
    .select('whatsapp_number, team_languages, alert_email, retention_days, no_reply_close_minutes')
    .eq('id', 1)
    .single<SupportSettings>();
}

export function saveSupportSettings(settings: SupportSettings) {
  return supabase
    .from('support_settings')
    .update({ ...settings, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('whatsapp_number, team_languages, alert_email, retention_days, no_reply_close_minutes')
    .single<SupportSettings>();
}
