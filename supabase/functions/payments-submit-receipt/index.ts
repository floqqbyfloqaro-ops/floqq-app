// Payments prototype, phase 5: after the ride the designated payer photographs the taxi receipt
// in the app (camera only) and the app uploads it to the private ride-receipts bucket. This reads
// the photo with Claude and checks it belongs to this ride (_shared/receiptChecks.ts) - the payer
// never types the amount, so an old receipt with a higher total can't be passed off as this one.
// A clean receipt is ACCEPTED straight away; anything doubtful is recorded as NEEDS_REVIEW for the
// admin, and nothing is paid out on it until they approve. Each passenger's final share is the
// existing fare split of the total; where a hold can't cover a share, FLOQQ covers the rest under
// the Ride Payment Guarantee (guarantee_used). Nothing is captured here.
//
// Deployed with the default JWT verification (any logged-in app user may call this); the caller
// must be the group's payer.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { rideDepartureMs } from '../_shared/holdMath.ts';
import { evaluateReceipt } from '../_shared/receiptChecks.ts';
import { recordReceipt } from '../_shared/receipts.ts';
import { ReceiptScanError, RECEIPT_SCAN_MODEL, scanReceipt, sniffImageType } from '../_shared/receiptScan.ts';
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

const RECEIPT_BUCKET = 'ride-receipts';
const PHOTO_FILE_PATTERN = /^[A-Za-z0-9_-]{1,80}\.(jpe?g|png|webp)$/;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
// Photos read per ride - retakes are fine, endless attempts are not.
const MAX_SCANS_PER_GROUP = 5;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
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
  let photoPath = '';
  try {
    const body = await req.json();
    groupId = typeof body?.groupId === 'string' ? body.groupId : '';
    photoPath = typeof body?.photoPath === 'string' ? body.photoPath : '';
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  if (!groupId || !photoPath) {
    return jsonResponse({ error: 'groupId and photoPath are required.' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: group } = await adminClient
    .from('taxi_groups')
    .select('id, status, total_fare, payer_request_id, payer_user_id')
    .eq('id', groupId)
    .single();
  if (!group || group.payer_user_id !== user.id || !group.payer_request_id) {
    return jsonResponse({ error: 'not_payer' }, 403);
  }
  if (group.status !== 'confirmed') {
    return jsonResponse({ error: 'group_not_confirmed' }, 409);
  }

  const { data: members } = await adminClient
    .from('passenger_requests')
    .select('id, user_id, arrival_at')
    .eq('group_id', groupId);
  const payer = members?.find((m) => m.id === group.payer_request_id);
  if (!members?.length || !payer || payer.user_id !== user.id) {
    return jsonResponse({ error: 'not_payer' }, 403);
  }

  // A receipt only exists once the taxi has left.
  const nowMs = Date.now();
  const departureMs = rideDepartureMs(members.map((m) => m.arrival_at));
  if (nowMs < departureMs) {
    return jsonResponse({ error: 'ride_not_started', rideAt: new Date(departureMs).toISOString() }, 409);
  }

  // An ESTIMATED receipt (the payer missed the deadline, phase 7) can still be replaced by the real
  // one - until the passengers are being charged.
  const { data: existing } = await adminClient
    .from('ride_receipts')
    .select('status, settlement_started_at')
    .eq('group_id', groupId)
    .maybeSingle();
  if (existing?.settlement_started_at) {
    return jsonResponse({ error: 'already_captured' }, 409);
  }
  if (existing?.status === 'ACCEPTED') {
    return jsonResponse({ error: 'already_accepted' }, 409);
  }

  const { count: scanCount } = await adminClient
    .from('ride_receipt_scans')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId);
  if ((scanCount ?? 0) >= MAX_SCANS_PER_GROUP) {
    return jsonResponse({ error: 'too_many_attempts' }, 429);
  }

  const [folder, file, ...rest] = photoPath.split('/');
  if (folder !== groupId || !file || rest.length > 0 || !PHOTO_FILE_PATTERN.test(file)) {
    return jsonResponse({ error: 'invalid_photo' }, 400);
  }
  const { data: blob } = await adminClient.storage.from(RECEIPT_BUCKET).download(photoPath);
  if (!blob) {
    return jsonResponse({ error: 'invalid_photo' }, 400);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mediaType = sniffImageType(bytes);
  if (!mediaType || bytes.length > MAX_PHOTO_BYTES) {
    return jsonResponse({ error: 'invalid_photo' }, 400);
  }
  const photoSha256 = await sha256Hex(bytes);

  const logScan = (row: Record<string, unknown>) =>
    adminClient.from('ride_receipt_scans').insert({
      group_id: groupId,
      user_id: user.id,
      photo_path: photoPath,
      photo_sha256: photoSha256,
      ...row,
    });

  let reading;
  try {
    reading = await scanReceipt(bytes, mediaType);
  } catch (err) {
    console.error('scanReceipt failed', err);
    await logScan({
      model: RECEIPT_SCAN_MODEL,
      outcome: 'SCAN_FAILED',
      reasons: [err instanceof ReceiptScanError ? err.message : 'api_error'],
    });
    return jsonResponse({ error: 'scan_failed' }, 502);
  }
  const { scan } = reading;

  // The same receipt or the same photo, already used for another ride?
  let duplicateReceipt = false;
  if (scan.taxiLicence && scan.receiptNumber) {
    const [{ data: receiptHits }, { data: scanHits }] = await Promise.all([
      adminClient
        .from('ride_receipts')
        .select('id')
        .eq('taxi_licence', scan.taxiLicence)
        .eq('receipt_number', scan.receiptNumber)
        .neq('group_id', groupId)
        .limit(1),
      adminClient
        .from('ride_receipt_scans')
        .select('id')
        .eq('taxi_licence', scan.taxiLicence)
        .eq('receipt_number', scan.receiptNumber)
        .neq('group_id', groupId)
        .limit(1),
    ]);
    duplicateReceipt = (receiptHits?.length ?? 0) > 0 || (scanHits?.length ?? 0) > 0;
  }
  const { data: photoHits } = await adminClient
    .from('ride_receipt_scans')
    .select('id')
    .eq('photo_sha256', photoSha256)
    .neq('group_id', groupId)
    .limit(1);
  const duplicatePhoto = (photoHits?.length ?? 0) > 0;

  const verdict = evaluateReceipt(scan, {
    arrivalTimes: members.map((m) => m.arrival_at),
    departureMs,
    nowMs,
    estimatedFareCents: group.total_fare != null ? Math.round(Number(group.total_fare) * 100) : null,
    duplicateReceipt,
    duplicatePhoto,
  });

  // Many receipts have no receipt number: the same licence, time and amount is the same trip too.
  if (verdict.outcome !== 'UNREADABLE' && !duplicateReceipt && scan.taxiLicence && verdict.receiptAtMs != null) {
    const { data: sameTrip } = await adminClient
      .from('ride_receipts')
      .select('id')
      .eq('taxi_licence', scan.taxiLicence)
      .eq('receipt_at', new Date(verdict.receiptAtMs).toISOString())
      .eq('total_cents', verdict.totalCents)
      .neq('group_id', groupId)
      .limit(1);
    if (sameTrip?.length) {
      verdict.reasons.push('duplicate_receipt');
      verdict.outcome = 'NEEDS_REVIEW';
    }
  }

  const receiptAtIso = verdict.outcome !== 'UNREADABLE' && verdict.receiptAtMs != null ? new Date(verdict.receiptAtMs).toISOString() : null;
  const scanRow = {
    model: reading.model,
    extraction: reading.raw,
    total_cents: verdict.outcome !== 'UNREADABLE' ? verdict.totalCents : null,
    receipt_at: receiptAtIso,
    taxi_licence: scan.taxiLicence || null,
    receipt_number: scan.receiptNumber || null,
  };

  if (verdict.outcome === 'UNREADABLE') {
    await logScan({ ...scanRow, outcome: 'UNREADABLE', reasons: [verdict.reason] });
    return jsonResponse({ error: 'unreadable', reason: verdict.reason }, 422);
  }

  const recorded = await recordReceipt(adminClient, {
    groupId,
    payerRequestId: payer.id,
    totalCents: verdict.totalCents,
    photoPath,
    status: verdict.outcome,
    actor: 'passenger',
    details: {
      receipt_at: receiptAtIso,
      taxi_licence: scan.taxiLicence || null,
      receipt_number: scan.receiptNumber || null,
      photo_sha256: photoSha256,
      review_reasons: verdict.reasons,
      total_source: 'photo',
    },
  });

  await logScan({
    ...scanRow,
    outcome: recorded.recorded ? verdict.outcome : 'LOCKED',
    reasons: recorded.recorded ? verdict.reasons : [recorded.reason],
  });

  if (!recorded.recorded) {
    return jsonResponse({ error: recorded.reason }, 409);
  }

  const { settlement } = recorded;
  return jsonResponse({
    status: verdict.outcome,
    reasons: verdict.reasons,
    totalCents: verdict.totalCents,
    receiptAt: receiptAtIso,
    payerShareCents: settlement.payerShareCents,
    reimbursementCents: settlement.reimbursementCents,
    holdsTotalCents: settlement.holdsTotalCents,
    guaranteeCents: settlement.guaranteeCents,
    guaranteeUsed: settlement.guaranteeUsed,
  });
});
