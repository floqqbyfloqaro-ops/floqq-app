// The admin's actions on a support ticket (src/screens/SupportTicketScreen.tsx):
//   { ticketId, action: 'note', body }                       -> an internal note (team only).
//   { ticketId, action: 'in_progress' }                      -> someone is on it.
//   { ticketId, action: 'called_resolved', category }        -> call back: reached and solved.
//   { ticketId, action: 'no_answer' }                        -> call back: not reached; the
//                                                               passenger gets "We tried to call you".
//   { ticketId, action: 'call_later', minutes: 30|60|120 }   -> call back: try again later.
//   { ticketId, action: 'resolve', category }                -> solved (any channel).
// Every action lands in the ticket's history (support_ticket_events). What each one changes is
// decided in _shared/supportInboxRules.ts.
//
// Deployed with the default JWT verification; the caller must be an admin.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { isAdminUser } from '../_shared/auth.ts';
import { sendPush } from '../_shared/push.ts';
import { applyAction, parseTicketAction } from '../_shared/supportInboxRules.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
  if (!user || !(await isAdminUser(admin, user.id))) return jsonResponse({ error: 'Forbidden' }, 403);

  const action = parseTicketAction(body);
  if (!action) return jsonResponse({ error: 'invalid_action' }, 400);

  const ticketId = typeof body.ticketId === 'string' ? body.ticketId : '';
  const { data: ticket } = await admin
    .from('support_tickets')
    .select('id, user_id, conversation_id, status, channel, first_contact_at, call_attempts, updated_at')
    .eq('id', ticketId)
    .maybeSingle();
  if (!ticket) return jsonResponse({ error: 'not_found' }, 404);

  const now = Date.now();
  const result = applyAction(
    { status: ticket.status, channel: ticket.channel, firstContactAt: ticket.first_contact_at, callAttempts: ticket.call_attempts },
    action,
    now
  );
  if ('error' in result) return jsonResponse({ error: result.error }, 409);

  if (Object.keys(result.change).length > 0) {
    // Only if nobody else changed it in the meantime (two admins on the same ticket).
    const { data: updated } = await admin
      .from('support_tickets')
      .update({ ...result.change, updated_at: new Date(now).toISOString() })
      .eq('id', ticket.id)
      .eq('updated_at', ticket.updated_at)
      .select('id');
    if (!updated?.length) return jsonResponse({ error: 'changed_meanwhile' }, 409);
  }

  await admin.from('support_ticket_events').insert({
    ticket_id: ticket.id,
    kind: action.action === 'resolve' ? 'resolved' : action.action,
    body:
      action.action === 'note'
        ? action.body.trim()
        : action.action === 'called_resolved' || action.action === 'resolve'
          ? action.category
          : action.action === 'call_later'
            ? `${action.minutes} min`
            : null,
    actor_id: user.id,
  });

  if (result.change.status === 'resolved' && ticket.conversation_id) {
    await admin
      .from('help_conversations')
      .update({ resolved_at: new Date(now).toISOString(), resolved_by: 'team' })
      .eq('id', ticket.conversation_id);
  }
  if (action.action === 'no_answer') {
    await sendPush(admin, { userId: ticket.user_id, key: 'supportNoAnswer', screen: 'help' });
  }

  return jsonResponse({ ok: true, status: result.change.status ?? ticket.status });
});
