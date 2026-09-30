// Payments prototype, phase 5: the admin's decision on a taxi receipt that needs review (or a
// correction of an accepted one). 'approve' accepts it - optionally with a corrected total, e.g.
// when the photo was read wrongly - and recomputes everyone's final share; 'reject' clears the
// shares so nothing can be captured, and the payer has to photograph the right receipt.
//
// Deployed with the default JWT verification; the caller must be the admin account.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { ADMIN_EMAIL } from '../_shared/constants.ts';
import { isValidReceiptTotal } from '../_shared/receiptMath.ts';
import { recordReceipt, scheduleSettlement } from '../_shared/receipts.ts';
import { paymentsEnabled } from '../_shared/stripe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }
  if (!paymentsEnabled()) {
    return jsonResponse({ error: 'Payments are disabled.' }, 403);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let groupId = '';
  let action = '';
  let totalCents: number | null = null;
  let note: string | null = null;
  try {
    const body = await req.json();
    groupId = typeof body?.groupId === 'string' ? body.groupId : '';
    action = body?.action === 'approve' || body?.action === 'reject' ? body.action : '';
    totalCents = typeof body?.totalCents === 'number' ? body.totalCents : null;
    note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  if (!groupId || !action) {
    return jsonResponse({ error: 'groupId and action are required.' }, 400);
  }
  if (totalCents != null && !isValidReceiptTotal(totalCents)) {
    return jsonResponse({ error: 'invalid_total' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData } = await adminClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  const admin = userData.user;
  if (!admin || admin.email !== ADMIN_EMAIL) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const { data: receipt } = await adminClient
    .from('ride_receipts')
    .select('group_id, payer_request_id, total_cents, status, total_source')
    .eq('group_id', groupId)
    .maybeSingle();
  if (!receipt?.payer_request_id) {
    return jsonResponse({ error: 'no_receipt' }, 404);
  }

  if (action === 'reject') {
    const { data, error } = await adminClient.rpc('system_reject_ride_receipt', {
      p_group_id: groupId,
      p_reviewer: admin.id,
      p_note: note,
    });
    if (error) {
      console.error('system_reject_ride_receipt failed', error);
      return jsonResponse({ error: 'record_failed' }, 500);
    }
    const result = data as { rejected: boolean; reason?: string };
    if (!result.rejected) return jsonResponse({ error: result.reason ?? 'record_failed' }, 409);
    // Nobody is charged on a rejected receipt.
    await scheduleSettlement(adminClient, groupId, { status: 'REJECTED', totalCents: null }).catch((err) =>
      console.error('scheduleSettlement failed', err)
    );
    return jsonResponse({ status: 'REJECTED' });
  }

  const corrected = totalCents != null && totalCents !== receipt.total_cents;
  const recorded = await recordReceipt(adminClient, {
    groupId,
    payerRequestId: receipt.payer_request_id,
    totalCents: totalCents ?? receipt.total_cents,
    photoPath: null,
    status: 'ACCEPTED',
    actor: 'admin',
    details: {
      total_source: corrected ? 'admin' : receipt.total_source,
      reviewed_by: admin.id,
      review_note: note,
    },
  });
  if (!recorded.recorded) {
    return jsonResponse({ error: recorded.reason }, 409);
  }
  return jsonResponse({ status: 'ACCEPTED', totalCents: totalCents ?? receipt.total_cents });
});
