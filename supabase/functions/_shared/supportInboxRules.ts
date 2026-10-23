// The pure rules behind the admin's support inbox (support-admin Edge Function): which actions
// the team can take on a ticket in which state, and what each one changes. No imports, so a plain
// Node test (supportInboxRules.test.ts) runs it.

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'no_answer';
export type TicketChannel = 'whatsapp' | 'callback';

export const RESOLUTION_CATEGORIES = ['refund_issue', 'app_bug', 'meeting_problem', 'payment', 'other'] as const;
export type ResolutionCategory = (typeof RESOLUTION_CATEGORIES)[number];

// "Call again later": how far ahead the next call is planned.
export const CALL_LATER_MINUTES = [30, 60, 120] as const;

export type TicketAction =
  | { action: 'note'; body: string }
  | { action: 'in_progress' }
  | { action: 'called_resolved'; category: ResolutionCategory }
  | { action: 'no_answer' }
  | { action: 'call_later'; minutes: number }
  | { action: 'resolve'; category: ResolutionCategory };

export type TicketState = { status: TicketStatus; channel: TicketChannel; firstContactAt: string | null; callAttempts: number };

export type TicketChange = {
  status?: TicketStatus;
  resolution_category?: ResolutionCategory;
  resolved_at?: string;
  first_contact_at?: string;
  call_attempts?: number;
  last_call_at?: string;
  callback_at?: string;
};

// What an action changes on the ticket, or why it isn't allowed. Notes change nothing on the
// ticket itself (they only go in its history).
export function applyAction(ticket: TicketState, action: TicketAction, nowMs: number): { change: TicketChange } | { error: string } {
  const now = new Date(nowMs).toISOString();
  const firstContact = ticket.firstContactAt ? {} : { first_contact_at: now };
  if (action.action === 'note') {
    const body = action.body.trim();
    return body.length === 0 || body.length > 2000 ? { error: 'invalid_note' } : { change: {} };
  }
  if (ticket.status === 'resolved') return { error: 'already_resolved' };
  const isCall = action.action === 'called_resolved' || action.action === 'no_answer' || action.action === 'call_later';
  if (isCall && ticket.channel !== 'callback') return { error: 'not_a_callback' };

  switch (action.action) {
    case 'in_progress':
      return { change: { status: 'in_progress', ...firstContact } };
    case 'called_resolved':
    case 'resolve':
      if (!RESOLUTION_CATEGORIES.includes(action.category)) return { error: 'invalid_category' };
      return {
        change: {
          status: 'resolved',
          resolution_category: action.category,
          resolved_at: now,
          ...firstContact,
          ...(action.action === 'called_resolved' ? { call_attempts: ticket.callAttempts + 1, last_call_at: now } : {}),
        },
      };
    case 'no_answer':
      // Nobody was reached, so it isn't a first contact yet.
      return { change: { status: 'no_answer', call_attempts: ticket.callAttempts + 1, last_call_at: now } };
    case 'call_later':
      if (!(CALL_LATER_MINUTES as readonly number[]).includes(action.minutes)) return { error: 'invalid_minutes' };
      return {
        change: {
          status: 'in_progress',
          call_attempts: ticket.callAttempts + 1,
          last_call_at: now,
          callback_at: new Date(nowMs + action.minutes * 60_000).toISOString(),
        },
      };
  }
}

export function parseTicketAction(body: Record<string, unknown>): TicketAction | null {
  switch (body.action) {
    case 'note':
      return typeof body.body === 'string' ? { action: 'note', body: body.body } : null;
    case 'in_progress':
    case 'no_answer':
      return { action: body.action };
    case 'called_resolved':
    case 'resolve':
      return { action: body.action, category: body.category as ResolutionCategory };
    case 'call_later':
      return { action: 'call_later', minutes: Number(body.minutes) };
    default:
      return null;
  }
}
