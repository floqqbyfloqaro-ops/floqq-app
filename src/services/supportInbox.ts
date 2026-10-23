import { supabase } from './supabase';

// Support tickets (supabase/migrations/20261023040000_support_tickets.sql and
// 20261023050000_support_inbox.sql). The admin reads every ticket, its conversation and the
// passenger's ride and payments (row level security); every change goes through the support-admin
// Edge Function. A passenger reads only their own tickets.

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'no_answer';
export type TicketChannel = 'whatsapp' | 'callback';
export type ResolutionCategory = 'refund_issue' | 'app_bug' | 'meeting_problem' | 'payment' | 'other';

export const RESOLUTION_CATEGORIES: ResolutionCategory[] = ['refund_issue', 'app_bug', 'meeting_problem', 'payment', 'other'];
export const TICKET_STATUSES: TicketStatus[] = ['open', 'in_progress', 'no_answer', 'resolved'];
export const CALL_LATER_MINUTES = [30, 60, 120] as const;

export type SupportTicket = {
  id: string;
  reference: string;
  user_id: string;
  conversation_id: string | null;
  request_id: string | null;
  category: string;
  language: 'en' | 'fr' | 'es';
  channel: TicketChannel;
  callback_phone: string | null;
  callback_at: string | null;
  status: TicketStatus;
  urgent: boolean;
  summary: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_category: ResolutionCategory | null;
  first_contact_at: string | null;
  call_attempts: number;
  last_call_at: string | null;
};

const TICKET_COLUMNS =
  'id, reference, user_id, conversation_id, request_id, category, language, channel, callback_phone, callback_at, status, urgent, summary, created_at, updated_at, resolved_at, resolution_category, first_contact_at, call_attempts, last_call_at';

export type TicketFilters = { status: TicketStatus | 'active' | 'all'; channel: TicketChannel | 'all'; language: 'en' | 'fr' | 'es' | 'all' };

// Urgent first, then oldest first: who has been waiting longest.
export function fetchTickets(filters: TicketFilters) {
  let query = supabase.from('support_tickets').select(TICKET_COLUMNS);
  if (filters.status === 'active') query = query.neq('status', 'resolved');
  else if (filters.status !== 'all') query = query.eq('status', filters.status);
  if (filters.channel !== 'all') query = query.eq('channel', filters.channel);
  if (filters.language !== 'all') query = query.eq('language', filters.language);
  return query
    .order('urgent', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(200)
    .returns<SupportTicket[]>();
}

export function fetchTicket(id: string) {
  return supabase.from('support_tickets').select(TICKET_COLUMNS).eq('id', id).single<SupportTicket>();
}

export type TicketEvent = { id: number; kind: string; body: string | null; actor_id: string | null; created_at: string };

export function fetchTicketEvents(ticketId: string) {
  return supabase
    .from('support_ticket_events')
    .select('id, kind, body, actor_id, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
    .returns<TicketEvent[]>();
}

export type ConversationMessage = { id: string; role: 'user' | 'assistant'; content: string; created_at: string };

export function fetchConversation(conversationId: string) {
  return supabase
    .from('help_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(300)
    .returns<ConversationMessage[]>();
}

export type TicketRide = {
  passengerName: string | null;
  flight: string | null;
  arrivalAt: string;
  terminal: string | null;
  destination: string;
  status: string;
  completedAt: string | null;
  group: { status: string; meetingTime: string | null; meetingPoint: string | null; rideStartedAt: string | null; isPayer: boolean } | null;
  payment: { status: string; holdCents: number | null; capturedCents: number | null; releasedCents: number | null; failure: string | null } | null;
};

// The ride the ticket is about, with its group and this passenger's payment (read-only).
export async function fetchTicketRide(requestId: string): Promise<TicketRide | null> {
  const { data: ride } = await supabase
    .from('passenger_requests')
    .select('id, passenger_name, flight_number, arrival_at, arrival_terminal, destination_address, status, completed_at, group_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!ride) return null;
  let group: TicketRide['group'] = null;
  let payment: TicketRide['payment'] = null;
  if (ride.group_id) {
    const [{ data: g }, { data: p }] = await Promise.all([
      supabase
        .from('taxi_groups')
        .select('status, meeting_time, ride_started_at, payer_request_id, meeting_point:meeting_points(short_code, terminal)')
        .eq('id', ride.group_id)
        .maybeSingle(),
      supabase
        .from('ride_payments')
        .select('payment_status, hold_amount_cents, captured_cents, released_cents, failure_reason')
        .eq('request_id', ride.id)
        .eq('group_id', ride.group_id)
        .maybeSingle(),
    ]);
    if (g) {
      const point = g.meeting_point as unknown as { short_code: string; terminal: string } | null;
      group = {
        status: g.status,
        meetingTime: g.meeting_time,
        meetingPoint: point ? `${point.short_code} · ${point.terminal}` : null,
        rideStartedAt: g.ride_started_at,
        isPayer: g.payer_request_id === ride.id,
      };
    }
    if (p) {
      payment = {
        status: p.payment_status,
        holdCents: p.hold_amount_cents,
        capturedCents: p.captured_cents,
        releasedCents: p.released_cents,
        failure: p.failure_reason,
      };
    }
  }
  return {
    passengerName: ride.passenger_name,
    flight: ride.flight_number || null,
    arrivalAt: ride.arrival_at,
    terminal: ride.arrival_terminal,
    destination: ride.destination_address,
    status: ride.status,
    completedAt: ride.completed_at,
    group,
    payment,
  };
}

export type TicketActionRequest =
  | { action: 'note'; body: string }
  | { action: 'in_progress' }
  | { action: 'called_resolved'; category: ResolutionCategory }
  | { action: 'no_answer' }
  | { action: 'call_later'; minutes: number }
  | { action: 'resolve'; category: ResolutionCategory };

// error: 'changed_meanwhile' | 'already_resolved' | 'not_a_callback' | ...
export async function runTicketAction(ticketId: string, request: TicketActionRequest) {
  const { error } = await supabase.functions.invoke('support-admin', { body: { ticketId, ...request } });
  if (!error) return { error: null as string | null };
  const context = (error as { context?: Response }).context;
  const body = context ? await context.json().catch(() => null) : null;
  return { error: (body?.error as string | undefined) ?? 'action_failed' };
}

export type MyTicket = Pick<SupportTicket, 'reference' | 'channel' | 'status' | 'callback_at' | 'resolved_at' | 'conversation_id'>;

// The passenger's own latest ticket, for the help screen: open ones, and resolved ones for a day.
export async function fetchMyLatestTicket(): Promise<MyTicket | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // Filtered on the user too: an admin may read everyone's tickets.
  const { data } = await supabase
    .from('support_tickets')
    .select('reference, channel, status, callback_at, resolved_at, conversation_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<MyTicket>();
  if (!data) return null;
  if (data.status === 'resolved' && data.resolved_at && Date.now() - Date.parse(data.resolved_at) > 24 * 60 * 60_000) return null;
  return data;
}
