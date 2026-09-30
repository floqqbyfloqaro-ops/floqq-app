// Splits a verified taxi total over a confirmed group and records it (receipt + every member's
// share) through system_record_ride_receipt. Used by payments-submit-receipt (payer's photo) and
// payments-review-receipt (admin approval). See 20260927010000_receipt_verification.sql.
// An ACCEPTED receipt also starts the passengers' dispute window (phase 6,
// 20260930000000_capture_and_reimburse.sql): scheduleSettlement sets when their cards are charged.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { ReceiptSettlement, settleReceipt } from './receiptMath.ts';
import { DEFAULT_DISPUTE_WINDOW_HOURS, settleAfterMs } from './settlementMath.ts';

// The DISPUTE_WINDOW_HOURS secret (e.g. 0.05 = 3 minutes, for testing), or the default.
export function disputeWindowHours(): number {
  const raw = Deno.env.get('DISPUTE_WINDOW_HOURS');
  const hours = raw ? Number(raw) : NaN;
  return Number.isFinite(hours) && hours >= 0 ? hours : DEFAULT_DISPUTE_WINDOW_HOURS;
}

// Receipts the passengers are charged on: a checked one, or the fallback estimate (phase 7).
export const SETTLEABLE_RECEIPT_STATUSES = ['ACCEPTED', 'ESTIMATED'];

// Sets (ACCEPTED / ESTIMATED) or clears (anything else) when the group's cards are charged, on the
// receipt and on every passenger's payment, together with the taxi total they see. Leaves a receipt
// that is already being settled alone. Returns the new time, if any.
export async function scheduleSettlement(
  adminClient: SupabaseClient,
  groupId: string,
  receipt: { status: string; totalCents: number | null },
  now = new Date()
): Promise<string | null> {
  let settleAfter: string | null = null;
  if (SETTLEABLE_RECEIPT_STATUSES.includes(receipt.status)) {
    const { data: holds } = await adminClient
      .from('ride_payments')
      .select('hold_expires_at')
      .eq('group_id', groupId)
      .eq('payment_status', 'HOLD_PLACED')
      .not('hold_expires_at', 'is', null);
    const expiries = (holds ?? []).map((h) => new Date(h.hold_expires_at).getTime());
    const earliestExpiryMs = expiries.length ? Math.min(...expiries) : null;
    settleAfter = new Date(settleAfterMs(now.getTime(), disputeWindowHours(), earliestExpiryMs)).toISOString();
  }

  const { data: updated } = await adminClient
    .from('ride_receipts')
    .update({ settle_after: settleAfter })
    .eq('group_id', groupId)
    .is('settlement_started_at', null)
    .select('id');
  if (!updated?.length) return null;

  await adminClient
    .from('ride_payments')
    .update({
      charge_at: settleAfter,
      taxi_total_cents: settleAfter ? receipt.totalCents : null,
      taxi_total_is_estimate: receipt.status === 'ESTIMATED',
    })
    .eq('group_id', groupId)
    .neq('payment_status', 'CAPTURED');
  return settleAfter;
}

export type ReceiptStatus = 'ACCEPTED' | 'NEEDS_REVIEW' | 'ESTIMATED';

export type ReceiptDetails = {
  receipt_at?: string | null;
  taxi_licence?: string | null;
  receipt_number?: string | null;
  photo_sha256?: string | null;
  review_reasons?: string[];
  total_source?: 'photo' | 'admin' | 'estimate';
  reviewed_by?: string;
  review_note?: string | null;
};

export type RecordResult = { recorded: true; settlement: ReceiptSettlement } | { recorded: false; reason: string };

export async function recordReceipt(
  adminClient: SupabaseClient,
  args: {
    groupId: string;
    payerRequestId: string;
    totalCents: number;
    photoPath: string | null;
    status: ReceiptStatus;
    details: ReceiptDetails;
    // 'system': the fallback ESTIMATED receipt (payments-settle-rides).
    actor: 'passenger' | 'admin' | 'system';
  }
): Promise<RecordResult> {
  const { data: members } = await adminClient
    .from('passenger_requests')
    .select('id, distance_km')
    .eq('group_id', args.groupId);
  if (!members?.length) return { recorded: false, reason: 'group_not_confirmed' };
  if (members.some((m) => m.distance_km == null)) return { recorded: false, reason: 'missing_distances' };

  const { data: payments } = await adminClient
    .from('ride_payments')
    .select('request_id, hold_amount_cents, platform_fee_cents, payment_status')
    .eq('group_id', args.groupId);
  const paymentByRequest = new Map((payments ?? []).map((p) => [p.request_id, p]));

  const settlement = settleReceipt(
    members.map((m) => {
      const payment = paymentByRequest.get(m.id);
      return {
        id: m.id,
        distanceKm: Number(m.distance_km),
        // Only a placed hold can be captured.
        holdAmountCents: payment?.payment_status === 'HOLD_PLACED' ? payment.hold_amount_cents : null,
        platformFeeCents: payment?.platform_fee_cents ?? 0,
      };
    }),
    args.payerRequestId,
    args.totalCents
  );

  const { data, error } = await adminClient.rpc('system_record_ride_receipt', {
    p_group_id: args.groupId,
    p_payer_request_id: args.payerRequestId,
    p_total_cents: args.totalCents,
    p_photo_path: args.photoPath,
    p_payer_share_cents: settlement.payerShareCents,
    p_holds_total_cents: settlement.holdsTotalCents,
    p_guarantee_cents: settlement.guaranteeCents,
    p_shares: settlement.shares.map((s) => ({
      request_id: s.id,
      receipt_share_cents: s.receiptShareCents,
      capture_share_cents: s.captureShareCents,
      guarantee_cents: s.guaranteeCents,
    })),
    p_status: args.status,
    p_details: args.details,
    p_actor: args.actor,
  });
  if (error) {
    console.error('system_record_ride_receipt failed', error);
    return { recorded: false, reason: 'record_failed' };
  }
  const result = data as { recorded: boolean; reason?: string };
  if (!result.recorded) return { recorded: false, reason: result.reason ?? 'record_failed' };

  // If this fails, payments-settle-rides schedules an ACCEPTED receipt on its next run.
  await scheduleSettlement(adminClient, args.groupId, { status: args.status, totalCents: args.totalCents }).catch((err) =>
    console.error('scheduleSettlement failed', err)
  );
  return { recorded: true, settlement };
}
