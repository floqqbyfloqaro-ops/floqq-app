// Splits a verified taxi total over a confirmed group and records it (receipt + every member's
// share) through system_record_ride_receipt. Used by payments-submit-receipt (payer's photo) and
// payments-review-receipt (admin approval). See 20260927010000_receipt_verification.sql.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { ReceiptSettlement, settleReceipt } from './receiptMath.ts';

export type ReceiptStatus = 'ACCEPTED' | 'NEEDS_REVIEW';

export type ReceiptDetails = {
  receipt_at?: string | null;
  taxi_licence?: string | null;
  receipt_number?: string | null;
  photo_sha256?: string | null;
  review_reasons?: string[];
  total_source?: 'photo' | 'admin';
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
    actor: 'passenger' | 'admin';
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
  return { recorded: true, settlement };
}
