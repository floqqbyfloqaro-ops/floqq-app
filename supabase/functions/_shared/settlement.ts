// Payments prototype, phase 6: settles a ride once its receipt's dispute window is over (see
// 20260930000000_capture_and_reimburse.sql and settlementMath.ts). Used by payments-settle-rides.
//
// Separate charges and transfers:
//   1. settleGroup captures every member's placed hold on FLOQQ's own Stripe account - share + fee,
//      only the fee for the payer. Capturing less than the hold releases the rest in the same step.
//   2. payPayer then transfers the others' shares to the payer's payout account: one transfer per
//      captured passenger, tied to that passenger's charge (source_transaction), so FLOQQ never
//      pays out money it hasn't received yet. What the captures don't cover (Ride Payment
//      Guarantee, failed captures) is one transfer from FLOQQ's own balance.
//
// Everything is safe to run again after a crash: captures use one idempotency key per payment,
// and existing transfers are looked up in Stripe (by transfer_group + metadata) before any new one
// is made. Every payment_status change lands in payment_events through the ride_payments trigger.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17';

import { markNotified } from './holds.ts';
import { retrievePayoutAccount, savePayoutStatus } from './payer.ts';
import { sendPush } from './push.ts';
import { capturePlan, outstandingCents, payoutPlan } from './settlementMath.ts';

type SettlementRow = {
  id: string;
  request_id: string | null;
  user_id: string | null;
  payment_status: string;
  stripe_payment_intent_id: string | null;
  hold_amount_cents: number;
  platform_fee_cents: number;
  final_share_cents: number | null;
  captured_cents: number | null;
  stripe_charge_id: string | null;
  payer_transfer_id: string | null;
  failure_reason: string | null;
  outstanding_cents: number | null;
};

const SETTLEMENT_COLUMNS =
  'id, request_id, user_id, payment_status, stripe_payment_intent_id, hold_amount_cents, platform_fee_cents, final_share_cents, captured_cents, stripe_charge_id, payer_transfer_id, failure_reason, outstanding_cents';

type Receipt = {
  group_id: string;
  // ACCEPTED, or ESTIMATED when the payer never sent one (phase 7 fallback).
  status: string;
  payer_request_id: string | null;
  payer_user_id: string | null;
  total_cents: number;
  reimbursement_cents: number;
  settled_at: string | null;
};

export type SettleResult = { groupId: string; outcome: string };

// The rows of the passengers still in the group - a cancelled seat has already been settled.
async function memberRows(adminClient: SupabaseClient, groupId: string): Promise<SettlementRow[]> {
  const [{ data: members }, { data: rows }] = await Promise.all([
    adminClient.from('passenger_requests').select('id').eq('group_id', groupId),
    adminClient.from('ride_payments').select(SETTLEMENT_COLUMNS).eq('group_id', groupId),
  ]);
  const memberIds = new Set((members ?? []).map((m) => m.id));
  return ((rows ?? []) as SettlementRow[]).filter((r) => r.request_id != null && memberIds.has(r.request_id));
}

// The part of a captured payment that goes on to the payer: the share, never more than was
// captured on top of the fee.
function capturedShareCents(row: SettlementRow): number {
  if (row.payment_status !== 'CAPTURED' || row.captured_cents == null || !row.stripe_charge_id) return 0;
  return Math.max(0, Math.min(row.final_share_cents ?? 0, row.captured_cents - row.platform_fee_cents));
}

async function captureRow(
  adminClient: SupabaseClient,
  stripe: Stripe,
  row: SettlementRow,
  receipt: Receipt,
  isPayer: boolean
): Promise<void> {
  if (!row.stripe_payment_intent_id) return;
  if (!isPayer && row.final_share_cents == null) {
    // The receipt set every member's share; a member without one needs the admin.
    console.error(`ride payment ${row.id} has no final share - not captured`);
    return;
  }

  const plan = capturePlan({
    holdAmountCents: row.hold_amount_cents,
    platformFeeCents: row.platform_fee_cents,
    captureShareCents: isPayer ? 0 : row.final_share_cents!,
  });

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.capture(
      row.stripe_payment_intent_id,
      { amount_to_capture: plan.captureCents },
      { idempotencyKey: `floqq-capture-${row.id}` }
    );
  } catch (err) {
    // Already captured by an earlier run that crashed before saving it?
    const existing = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id).catch(() => null);
    if (existing?.status === 'succeeded') {
      intent = existing;
    } else {
      // The payer is still paid in full (the guarantee covers this share); what this passenger
      // didn't pay is recorded as outstanding for the admin.
      console.error(`capture of ride payment ${row.id} failed`, err);
      const expired = existing?.status === 'canceled' && existing.cancellation_reason === 'automatic';
      const reason = expired ? 'hold_expired' : (err as { code?: string }).code ?? existing?.status ?? 'capture_error';
      const { data: failed } = await adminClient
        .from('ride_payments')
        .update({
          payment_status: 'CAPTURE_FAILED',
          failure_reason: `settlement: ${reason}`,
          last_status_actor: 'system',
        })
        .eq('id', row.id)
        .eq('payment_status', 'HOLD_PLACED')
        .select('id');
      if (failed?.length) await recordOutstanding(adminClient, { ...row, payment_status: 'CAPTURE_FAILED' }, isPayer, reason);
      return;
    }
  }

  const capturedCents = intent.amount_received;
  const releasedCents = row.hold_amount_cents - capturedCents;
  const chargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id ?? null;

  await adminClient
    .from('ride_payments')
    .update({
      payment_status: 'CAPTURED',
      captured_at: new Date().toISOString(),
      captured_cents: capturedCents,
      released_cents: releasedCents,
      stripe_charge_id: chargeId,
      taxi_total_cents: receipt.total_cents,
      taxi_total_is_estimate: receipt.status === 'ESTIMATED',
      failure_reason: null,
      last_status_actor: 'system',
    })
    .eq('id', row.id)
    // The webhook may have recorded the capture first (holdTransition 'succeeded').
    .in('payment_status', ['HOLD_PLACED', 'CAPTURED']);

  // The payer hears about their reimbursement instead.
  if (!isPayer && row.user_id && (await markNotified(adminClient, row.id, 'settled_notified_at'))) {
    await sendPush(adminClient, {
      userId: row.user_id,
      key: receipt.status === 'ESTIMATED' ? 'ridePaidEstimate' : 'ridePaid',
      rideCents: {
        total: receipt.total_cents,
        share: capturedCents - row.platform_fee_cents,
        fee: row.platform_fee_cents,
        released: releasedCents,
      },
    });
  }
}

// Records what a passenger didn't pay because their hold couldn't be captured (failed capture, or
// the hold expired or was released before the capture), once, and tells them.
async function recordOutstanding(adminClient: SupabaseClient, row: SettlementRow, isPayer: boolean, reason: string) {
  const { data: recorded } = await adminClient
    .from('ride_payments')
    .update({
      outstanding_cents: outstandingCents({
        isPayer,
        finalShareCents: row.final_share_cents,
        platformFeeCents: row.platform_fee_cents,
      }),
      outstanding_reason: reason,
      outstanding_since: new Date().toISOString(),
    })
    .eq('id', row.id)
    .is('outstanding_cents', null)
    .select('id');
  if (recorded?.length && row.user_id && (await markNotified(adminClient, row.id, 'settled_notified_at'))) {
    await sendPush(adminClient, { userId: row.user_id, key: 'captureFailed' });
  }
}

// Captures what's due for one group, then reimburses the payer. Returns what happened.
export async function settleGroup(adminClient: SupabaseClient, stripe: Stripe, groupId: string): Promise<SettleResult> {
  const { data: begin, error: beginError } = await adminClient.rpc('system_begin_ride_settlement', { p_group_id: groupId });
  if (beginError) {
    console.error('system_begin_ride_settlement failed', beginError);
    return { groupId, outcome: 'begin_failed' };
  }
  const started = begin as { started: boolean; reason?: string };
  if (!started.started) return { groupId, outcome: started.reason ?? 'not_started' };

  const { data: receiptData } = await adminClient
    .from('ride_receipts')
    .select('group_id, status, payer_request_id, payer_user_id, total_cents, reimbursement_cents, settled_at')
    .eq('group_id', groupId)
    .single();
  const receipt = receiptData as Receipt | null;
  if (!receipt?.payer_request_id) return { groupId, outcome: 'no_receipt' };

  if (!receipt.settled_at) {
    for (const row of await memberRows(adminClient, groupId)) {
      if (row.payment_status !== 'HOLD_PLACED') continue;
      await captureRow(adminClient, stripe, row, receipt, row.request_id === receipt.payer_request_id);
    }

    const rows = await memberRows(adminClient, groupId);
    if (rows.some((r) => r.payment_status === 'HOLD_PLACED')) return { groupId, outcome: 'captures_pending' };

    // A member whose hold was gone before the capture - it expired, or was released - owes it too.
    for (const row of rows) {
      if (row.payment_status === 'CAPTURED' || row.outstanding_cents != null) continue;
      await recordOutstanding(
        adminClient,
        row,
        row.request_id === receipt.payer_request_id,
        row.failure_reason ?? row.payment_status.toLowerCase()
      );
    }

    await adminClient
      .from('ride_receipts')
      .update({ settled_at: new Date().toISOString() })
      .eq('group_id', groupId)
      .is('settled_at', null);
  }

  return { groupId, outcome: await payPayer(adminClient, stripe, receipt) };
}

type Payout = {
  id: string;
  amount_cents: number;
  guarantee_cents: number;
  status: string;
  guarantee_transfer_id: string | null;
  transfer_attempts: number;
  approved_at: string | null;
};

// Is the payer's payout account able to receive money? Asks Stripe when the saved state isn't
// COMPLETE yet, since the payer may have finished Stripe's checks without opening the app.
async function payoutAccountReady(adminClient: SupabaseClient, userId: string): Promise<string | null> {
  const { data: profile } = await adminClient
    .from('user_payment_profiles')
    .select('stripe_connect_account_id, payout_onboarding_status')
    .eq('user_id', userId)
    .maybeSingle();
  const accountId = profile?.stripe_connect_account_id as string | null | undefined;
  if (!accountId) return null;
  if (profile!.payout_onboarding_status === 'COMPLETE') return accountId;

  try {
    const state = await savePayoutStatus(adminClient, userId, await retrievePayoutAccount(accountId));
    return state.status === 'COMPLETE' ? accountId : null;
  } catch (err) {
    console.warn('payout account refresh failed', err);
    return null;
  }
}

// Sends the payer everything they're owed. Once the payout row exists its split is fixed; runs
// again (every 5 minutes) until every transfer has gone through.
async function payPayer(adminClient: SupabaseClient, stripe: Stripe, receipt: Receipt): Promise<string> {
  const groupId = receipt.group_id;
  if (!receipt.payer_user_id) return 'no_payer';

  // All of the group's rows, not just current members: a passenger may close their finished ride
  // before the payer's payout goes out. Only settlement captures carry a charge id (a
  // cancellation fee doesn't), so nothing else is ever passed on.
  const { data: allRows } = await adminClient.from('ride_payments').select(SETTLEMENT_COLUMNS).eq('group_id', groupId);
  const shareRows = ((allRows ?? []) as SettlementRow[]).filter((r) => r.request_id !== receipt.payer_request_id);
  const plan = payoutPlan(
    receipt.reimbursement_cents,
    shareRows.map((r) => ({ id: r.id, shareCents: capturedShareCents(r) }))
  );
  const transferGroup = `floqq-ride-${groupId}`;

  await adminClient.from('ride_payouts').upsert(
    {
      group_id: groupId,
      payer_request_id: receipt.payer_request_id,
      payer_user_id: receipt.payer_user_id,
      amount_cents: receipt.reimbursement_cents,
      from_captures_cents: plan.fromCapturesCents,
      guarantee_cents: plan.guaranteeCents,
      stripe_transfer_group: transferGroup,
    },
    { onConflict: 'group_id', ignoreDuplicates: true }
  );

  const { data: payoutData } = await adminClient
    .from('ride_payouts')
    .select('id, amount_cents, guarantee_cents, status, guarantee_transfer_id, transfer_attempts, approved_at')
    .eq('group_id', groupId)
    .single();
  const payout = payoutData as Payout | null;
  if (!payout) return 'payout_row_failed';
  if (payout.status === 'SENT') return 'sent';

  // Nobody checked a receipt: the admin approves this payout first (payments-admin-actions).
  if (receipt.status === 'ESTIMATED' && !payout.approved_at) {
    await adminClient.from('ride_payouts').update({ status: 'HELD_FOR_REVIEW' }).eq('id', payout.id).neq('status', 'SENT');
    return 'held_for_review';
  }

  const accountId = await payoutAccountReady(adminClient, receipt.payer_user_id);
  if (!accountId) {
    await adminClient.from('ride_payouts').update({ status: 'WAITING_FOR_PAYOUT_SETUP' }).eq('id', payout.id).neq('status', 'SENT');
    const { data: claimed } = await adminClient
      .from('ride_payouts')
      .update({ waiting_notified_at: new Date().toISOString() })
      .eq('id', payout.id)
      .is('waiting_notified_at', null)
      .select('id');
    if (claimed?.length) {
      await sendPush(adminClient, { userId: receipt.payer_user_id, key: 'reimbursementWaiting', amountCents: payout.amount_cents });
    }
    return 'waiting_for_payout_setup';
  }

  // One number per attempt: Stripe replays a refused request for the same idempotency key, so a
  // retry (e.g. once FLOQQ's balance is topped up) needs a fresh one.
  const attempt = payout.transfer_attempts + 1;
  const { data: claimedAttempt } = await adminClient
    .from('ride_payouts')
    .update({ transfer_attempts: attempt, status: 'PENDING', stripe_account_id: accountId })
    .eq('id', payout.id)
    .eq('transfer_attempts', payout.transfer_attempts)
    .select('id');
  if (!claimedAttempt?.length) return 'busy';

  // Transfers an earlier, interrupted run already made.
  const existing = await stripe.transfers.list({ transfer_group: transferGroup, limit: 100 });
  const existingFor = (key: string) => existing.data.find((t) => t.metadata?.floqq_part === key && !t.reversed);

  const failures: string[] = [];
  let transferredCents = 0;

  for (const row of shareRows) {
    const shareCents = capturedShareCents(row);
    if (shareCents <= 0) continue;
    let transferId = row.payer_transfer_id ?? existingFor(row.id)?.id ?? null;
    if (!transferId) {
      try {
        const transfer = await stripe.transfers.create(
          {
            amount: shareCents,
            currency: 'eur',
            destination: accountId,
            // Moves only once this passenger's payment is available - never FLOQQ's own money.
            source_transaction: row.stripe_charge_id!,
            transfer_group: transferGroup,
            description: 'FLOQQ shared taxi - a passenger’s share',
            metadata: { floqq_part: row.id, group_id: groupId, kind: 'share' },
          },
          { idempotencyKey: `floqq-transfer-${row.id}-${attempt}` }
        );
        transferId = transfer.id;
      } catch (err) {
        console.error(`transfer for ride payment ${row.id} failed`, err);
        failures.push(`share:${(err as { code?: string }).code ?? 'transfer_error'}`);
        continue;
      }
    }
    if (transferId !== row.payer_transfer_id) {
      await adminClient.from('ride_payments').update({ payer_transfer_id: transferId }).eq('id', row.id);
    }
    transferredCents += shareCents;
  }

  if (payout.guarantee_cents > 0) {
    let transferId = payout.guarantee_transfer_id ?? existingFor('guarantee')?.id ?? null;
    if (!transferId) {
      try {
        const transfer = await stripe.transfers.create(
          {
            amount: payout.guarantee_cents,
            currency: 'eur',
            destination: accountId,
            // FLOQQ's own money: needs enough available balance on FLOQQ's account.
            transfer_group: transferGroup,
            description: 'FLOQQ shared taxi - Ride Payment Guarantee',
            metadata: { floqq_part: 'guarantee', group_id: groupId, kind: 'guarantee' },
          },
          { idempotencyKey: `floqq-guarantee-${groupId}-${attempt}` }
        );
        transferId = transfer.id;
      } catch (err) {
        console.error(`guarantee transfer for group ${groupId} failed`, err);
        failures.push(`guarantee:${(err as { code?: string }).code ?? 'transfer_error'}`);
      }
    }
    if (transferId) {
      if (transferId !== payout.guarantee_transfer_id) {
        await adminClient.from('ride_payouts').update({ guarantee_transfer_id: transferId }).eq('id', payout.id);
      }
      transferredCents += payout.guarantee_cents;
    }
  }

  const complete = failures.length === 0;
  await adminClient
    .from('ride_payouts')
    .update({
      transferred_cents: Math.min(transferredCents, payout.amount_cents),
      status: complete ? 'SENT' : 'PENDING',
      sent_at: complete ? new Date().toISOString() : null,
      failure_reason: complete ? null : failures.join(', '),
    })
    .eq('id', payout.id);
  if (!complete) return 'transfers_pending';

  const { data: claimed } = await adminClient
    .from('ride_payouts')
    .update({ sent_notified_at: new Date().toISOString() })
    .eq('id', payout.id)
    .is('sent_notified_at', null)
    .select('id');
  if (claimed?.length) {
    await sendPush(adminClient, { userId: receipt.payer_user_id, key: 'reimbursementSent', amountCents: payout.amount_cents });
  }
  return 'sent';
}
