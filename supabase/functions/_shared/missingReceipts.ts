// Payments prototype, phase 7: a payer who doesn't photograph the taxi receipt. Used by
// payments-settle-rides every 5 minutes, for confirmed groups whose ride has left, that still have
// placed holds and no receipt (or only a REJECTED one):
//   1. RECEIPT_REMINDER_AFTER_RIDE_MINUTES after the ride: "photograph the receipt" push.
//   2. RECEIPT_FINAL_REMINDER_BEFORE_DEADLINE_HOURS before the deadline: a last reminder.
//   3. At the deadline (receiptDeadlineMs - a day after the ride, but always early enough to
//      capture before the holds expire): an ESTIMATED receipt from the group's estimated fare,
//      settled like any other receipt. The payer's payout from it waits for the admin
//      (settlement.ts, HELD_FOR_REVIEW), and a real receipt sent before the capture still wins.
// See 20261001000000_payment_failure_handling.sql.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { rideDepartureMs } from './holdMath.ts';
import { sendPush } from './push.ts';
import { recordReceipt } from './receipts.ts';
import { missingReceiptStep, receiptDeadlineMs } from './settlementMath.ts';

type GroupRow = {
  id: string;
  total_fare: number | null;
  payer_request_id: string | null;
  payer_user_id: string | null;
  receipt_deadline_at: string | null;
  receipt_reminder_sent_at: string | null;
  receipt_final_reminder_sent_at: string | null;
};

export type MissingReceiptResult = { groupId: string; step: string };

// Claims a one-time reminder column on the group: true only for the single caller that set it.
async function claimReminder(
  adminClient: SupabaseClient,
  groupId: string,
  columns: ('receipt_reminder_sent_at' | 'receipt_final_reminder_sent_at')[],
  now: Date
): Promise<boolean> {
  const update = Object.fromEntries(columns.map((c) => [c, now.toISOString()]));
  const { data } = await adminClient
    .from('taxi_groups')
    .update(update)
    .eq('id', groupId)
    .is(columns[columns.length - 1], null)
    .select('id');
  return (data?.length ?? 0) > 0;
}

export async function handleMissingReceipts(adminClient: SupabaseClient, now = new Date()): Promise<MissingReceiptResult[]> {
  const results: MissingReceiptResult[] = [];

  // Only rides that still have money on hold can be settled - the others have nothing to lose.
  const { data: holds } = await adminClient
    .from('ride_payments')
    .select('group_id, hold_expires_at')
    .eq('payment_status', 'HOLD_PLACED')
    .not('group_id', 'is', null);
  const expiryByGroup = new Map<string, number | null>();
  for (const hold of holds ?? []) {
    const expiryMs = hold.hold_expires_at ? new Date(hold.hold_expires_at).getTime() : null;
    const current = expiryByGroup.get(hold.group_id);
    if (!expiryByGroup.has(hold.group_id)) expiryByGroup.set(hold.group_id, expiryMs);
    else if (expiryMs != null && (current == null || expiryMs < current)) expiryByGroup.set(hold.group_id, expiryMs);
  }
  const groupIds = [...expiryByGroup.keys()];
  if (!groupIds.length) return results;

  const [{ data: groups }, { data: receipts }, { data: members }] = await Promise.all([
    adminClient
      .from('taxi_groups')
      .select('id, total_fare, payer_request_id, payer_user_id, receipt_deadline_at, receipt_reminder_sent_at, receipt_final_reminder_sent_at')
      .in('id', groupIds)
      .eq('status', 'confirmed')
      .not('payer_request_id', 'is', null),
    adminClient.from('ride_receipts').select('group_id, status').in('group_id', groupIds),
    adminClient.from('passenger_requests').select('group_id, arrival_at').in('group_id', groupIds),
  ]);
  const receiptStatus = new Map((receipts ?? []).map((r) => [r.group_id, r.status as string]));

  for (const group of (groups ?? []) as GroupRow[]) {
    const status = receiptStatus.get(group.id);
    if (status && status !== 'REJECTED') continue;

    const arrivals = (members ?? []).filter((m) => m.group_id === group.id).map((m) => m.arrival_at as string);
    if (!arrivals.length) continue;
    const departureMs = rideDepartureMs(arrivals);
    if (now.getTime() < departureMs) continue;

    const deadlineMs = receiptDeadlineMs(departureMs, expiryByGroup.get(group.id) ?? null);
    const deadlineIso = new Date(deadlineMs).toISOString();
    if (!group.receipt_deadline_at || new Date(group.receipt_deadline_at).getTime() !== deadlineMs) {
      // Shown to the payer on My ride.
      await adminClient.from('taxi_groups').update({ receipt_deadline_at: deadlineIso }).eq('id', group.id);
    }

    const step = missingReceiptStep(now.getTime(), departureMs, deadlineMs, {
      reminder: group.receipt_reminder_sent_at != null,
      finalReminder: group.receipt_final_reminder_sent_at != null,
    });
    if (step === 'wait' || !group.payer_user_id || !group.payer_request_id) continue;

    if (step === 'reminder') {
      if (await claimReminder(adminClient, group.id, ['receipt_reminder_sent_at'], now)) {
        await sendPush(adminClient, { userId: group.payer_user_id, key: 'receiptReminder', timeIso: deadlineIso });
      }
    } else if (step === 'final_reminder') {
      if (await claimReminder(adminClient, group.id, ['receipt_reminder_sent_at', 'receipt_final_reminder_sent_at'], now)) {
        await sendPush(adminClient, { userId: group.payer_user_id, key: 'receiptFinalReminder', timeIso: deadlineIso });
      }
    } else {
      if (group.total_fare == null) {
        // Nothing to estimate from - the admin has to sort this ride out (flagged on the dashboard).
        console.error(`group ${group.id} has no receipt and no estimated fare`);
        results.push({ groupId: group.id, step: 'fallback_no_estimate' });
        continue;
      }
      const recorded = await recordReceipt(adminClient, {
        groupId: group.id,
        payerRequestId: group.payer_request_id,
        totalCents: Math.round(Number(group.total_fare) * 100),
        photoPath: null,
        status: 'ESTIMATED',
        actor: 'system',
        details: { total_source: 'estimate', review_reasons: ['no_receipt'] },
      });
      if (!recorded.recorded) {
        results.push({ groupId: group.id, step: `fallback_${recorded.reason}` });
        continue;
      }
      await sendPush(adminClient, {
        userId: group.payer_user_id,
        key: 'receiptEstimated',
        amountCents: recorded.settlement.reimbursementCents,
      });
    }
    results.push({ groupId: group.id, step });
  }

  return results;
}
