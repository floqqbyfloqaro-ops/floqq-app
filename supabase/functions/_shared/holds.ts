// Keeps a confirmed group's ride_payments rows (one per passenger) in step with its membership,
// and releases holds that no longer belong to an active group member. Used by
// payments-sync-holds (admin "confirm" + the 5-minute cron job). Every payment_status change
// is written to payment_events by the ride_payments trigger; last_status_actor says who did it.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17';

import { estimatedSharesCents, holdAmountCents, holdCovers, holdWindow, PLATFORM_FEE_CENTS, rideDepartureMs } from './holdMath.ts';

export type RidePaymentRow = {
  id: string;
  request_id: string | null;
  group_id: string | null;
  user_id: string | null;
  estimated_share_cents: number;
  hold_amount_cents: number;
  stripe_payment_intent_id: string | null;
  payment_status: string;
  hold_deadline_at: string | null;
};

export const RIDE_PAYMENT_COLUMNS =
  'id, request_id, group_id, user_id, estimated_share_cents, hold_amount_cents, stripe_payment_intent_id, payment_status, hold_deadline_at';

// Statuses in which a Stripe hold may still be open and must be cancelled if it's no longer needed.
const OPEN_HOLD_STATUSES = ['HOLD_PENDING_AUTH', 'HOLD_PLACED'];

// Cancels (releases) a hold. Safe to repeat: an already-cancelled PaymentIntent is fine.
export async function cancelHold(stripe: Stripe, paymentIntentId: string): Promise<void> {
  try {
    await stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey: `floqq-cancel-${paymentIntentId}` });
  } catch (err) {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId).catch(() => null);
    if (intent?.status === 'canceled') return;
    throw err;
  }
}

export type SyncResult = { groupId: string; outcome: string };

// Creates missing rows for a confirmed group's members and adjusts amounts after a membership
// change. A placed hold that no longer covers the new share is released and the passenger is
// asked to reserve again with a fresh window. Holds of a group that's no longer confirmed are
// released.
export async function syncGroupHolds(
  adminClient: SupabaseClient,
  stripe: Stripe,
  groupId: string,
  now = new Date()
): Promise<SyncResult> {
  const { data: group, error: groupError } = await adminClient
    .from('taxi_groups')
    .select('id, status, total_fare')
    .eq('id', groupId)
    .single();
  if (groupError || !group) return { groupId, outcome: 'group_not_found' };

  const { data: members, error: membersError } = await adminClient
    .from('passenger_requests')
    .select('id, user_id, distance_km, arrival_at')
    .eq('group_id', groupId);
  if (membersError || !members) return { groupId, outcome: 'members_load_failed' };

  const { data: existingRows, error: rowsError } = await adminClient
    .from('ride_payments')
    .select(RIDE_PAYMENT_COLUMNS)
    .eq('group_id', groupId);
  if (rowsError) return { groupId, outcome: 'payments_load_failed' };
  const rows = (existingRows ?? []) as RidePaymentRow[];

  const memberIds = new Set(members.map((m) => m.id));
  const groupActive = group.status === 'confirmed';

  // Release holds of passengers who are no longer in this (still confirmed) group.
  for (const row of rows) {
    const stillMember = groupActive && row.request_id != null && memberIds.has(row.request_id);
    if (!stillMember && OPEN_HOLD_STATUSES.includes(row.payment_status) && row.stripe_payment_intent_id) {
      await cancelHold(stripe, row.stripe_payment_intent_id);
      await adminClient
        .from('ride_payments')
        .update({
          payment_status: 'RELEASED',
          released_at: now.toISOString(),
          failure_reason: groupActive ? 'removed_from_group' : 'group_dissolved',
          last_status_actor: 'system',
        })
        .eq('id', row.id)
        .eq('payment_status', row.payment_status);
    }
  }

  if (!groupActive) return { groupId, outcome: 'released_inactive_group' };

  if (group.total_fare == null || members.some((m) => m.distance_km == null)) {
    return { groupId, outcome: 'missing_fare_or_distances' };
  }

  const shares = estimatedSharesCents(
    members.map((m) => ({ id: m.id, distanceKm: Number(m.distance_km) })),
    Number(group.total_fare)
  );
  const rideMs = rideDepartureMs(members.map((m) => m.arrival_at));
  const rowByRequest = new Map(rows.filter((r) => r.request_id).map((r) => [r.request_id!, r]));

  for (const member of members) {
    const shareCents = shares.get(member.id)!;
    const holdCents = holdAmountCents(shareCents);
    const row = rowByRequest.get(member.id);

    if (!row) {
      const { opensAt, deadlineAt } = holdWindow(rideMs, now.getTime());
      await adminClient.from('ride_payments').upsert(
        {
          request_id: member.id,
          group_id: groupId,
          user_id: member.user_id,
          estimated_share_cents: shareCents,
          platform_fee_cents: PLATFORM_FEE_CENTS,
          hold_amount_cents: holdCents,
          hold_window_opens_at: opensAt.toISOString(),
          hold_deadline_at: deadlineAt.toISOString(),
          last_status_actor: 'system',
        },
        { onConflict: 'request_id,group_id', ignoreDuplicates: true }
      );
      continue;
    }

    if (row.estimated_share_cents === shareCents) continue;

    if (row.payment_status === 'NOT_STARTED' || row.payment_status === 'HOLD_FAILED' || row.payment_status === 'RELEASED') {
      // Nothing held yet - just update what will be held. The running deadline stays.
      await adminClient
        .from('ride_payments')
        .update({ estimated_share_cents: shareCents, hold_amount_cents: holdCents })
        .eq('id', row.id)
        .eq('payment_status', row.payment_status);
      continue;
    }

    if (row.payment_status === 'HOLD_PLACED' && holdCovers(row.hold_amount_cents, shareCents)) {
      // The existing hold still covers the new share - keep it.
      await adminClient.from('ride_payments').update({ estimated_share_cents: shareCents }).eq('id', row.id);
      continue;
    }

    if (row.payment_status === 'HOLD_PLACED' || row.payment_status === 'HOLD_PENDING_AUTH') {
      // The share went up beyond the hold (or a hold for the old amount is mid-authentication):
      // release it and ask the passenger to reserve the new amount, with a fresh window.
      if (row.stripe_payment_intent_id) await cancelHold(stripe, row.stripe_payment_intent_id);
      const { opensAt, deadlineAt } = holdWindow(rideMs, now.getTime());
      await adminClient
        .from('ride_payments')
        .update({
          payment_status: 'NOT_STARTED',
          stripe_payment_intent_id: null,
          estimated_share_cents: shareCents,
          hold_amount_cents: holdCents,
          hold_placed_at: null,
          hold_expires_at: null,
          hold_window_opens_at: opensAt.toISOString(),
          hold_deadline_at: deadlineAt.toISOString(),
          failure_reason: 'share_increased',
          last_status_actor: 'system',
        })
        .eq('id', row.id)
        .eq('payment_status', row.payment_status);
    }
  }

  return { groupId, outcome: 'synced' };
}

type StatusActor = 'passenger' | 'system' | 'stripe';

// From which statuses each Stripe PaymentIntent state may move a row. Anything else is a stale or
// out-of-order update and is ignored, so e.g. a late "failed" can never undo a placed hold.
const TRANSITIONS: Record<string, { to: string; from: string[] }> = {
  requires_capture: { to: 'HOLD_PLACED', from: ['NOT_STARTED', 'HOLD_PENDING_AUTH', 'HOLD_FAILED'] },
  requires_action: { to: 'HOLD_PENDING_AUTH', from: ['NOT_STARTED', 'HOLD_FAILED'] },
  requires_payment_method: { to: 'HOLD_FAILED', from: ['NOT_STARTED', 'HOLD_PENDING_AUTH', 'HOLD_FAILED'] },
  canceled: { to: 'RELEASED', from: ['HOLD_PLACED', 'HOLD_PENDING_AUTH'] },
};

// Reads the hold's current state straight from Stripe and applies it to its ride_payments row.
// Both payments-place-hold (right after creating the hold) and stripe-webhook call this, always
// with a freshly retrieved PaymentIntent - never with a client's word for it.
export async function applyHoldState(
  adminClient: SupabaseClient,
  stripe: Stripe,
  paymentIntentId: string,
  actor: StatusActor
): Promise<string | null> {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  const ridePaymentId = intent.metadata?.ride_payment_id;
  if (!ridePaymentId) return null; // Not a ride hold (e.g. the old service-fee Checkout).

  const { data: row } = await adminClient
    .from('ride_payments')
    .select('id, payment_status, stripe_payment_intent_id, hold_attempts')
    .eq('id', ridePaymentId)
    .single();
  if (!row) return null;

  // The row moved on to another attempt. If this orphan still holds money, release it - FLOQQ
  // never keeps a hold it doesn't track.
  const isCurrent =
    row.stripe_payment_intent_id === intent.id ||
    (row.stripe_payment_intent_id == null && String(row.hold_attempts) === intent.metadata?.attempt);
  if (!isCurrent) {
    if (intent.status === 'requires_capture' || intent.status === 'requires_action') {
      await cancelHold(stripe, intent.id);
    }
    return row.payment_status;
  }

  const transition = TRANSITIONS[intent.status];
  if (!transition || !transition.from.includes(row.payment_status)) return row.payment_status;

  const update: Record<string, unknown> = {
    payment_status: transition.to,
    stripe_payment_intent_id: intent.id,
    last_status_actor: actor,
  };

  if (transition.to === 'HOLD_PLACED') {
    const charge = intent.latest_charge as Stripe.Charge | null;
    const captureBefore = charge?.payment_method_details?.card?.capture_before;
    update.hold_placed_at = new Date().toISOString();
    update.hold_expires_at = captureBefore ? new Date(captureBefore * 1000).toISOString() : null;
    update.failure_reason = null;
  } else if (transition.to === 'HOLD_FAILED') {
    const lastError = intent.last_payment_error;
    update.failure_reason = lastError?.decline_code ?? lastError?.code ?? 'payment_failed';
  } else if (transition.to === 'RELEASED') {
    update.released_at = new Date().toISOString();
    update.failure_reason = intent.cancellation_reason === 'automatic' ? 'hold_expired' : intent.cancellation_reason;
  }

  const { data: updated } = await adminClient
    .from('ride_payments')
    .update(update)
    .eq('id', row.id)
    .eq('payment_status', row.payment_status)
    .select('payment_status');

  return updated?.[0]?.payment_status ?? row.payment_status;
}

// A passenger cancelled their ride after the group was confirmed. With a placed hold, FLOQQ keeps
// only the platform fee: capturing less than the hold releases the rest automatically, in one
// transaction. A hold still waiting for 3D Secure is simply cancelled (nothing is charged), and
// without a hold there is nothing to charge. A failed capture never blocks the cancellation - it
// is recorded as CAPTURE_FAILED for the admin.
export async function settleCancelledSeat(
  adminClient: SupabaseClient,
  stripe: Stripe,
  requestId: string,
  groupId: string
): Promise<string> {
  const { data } = await adminClient
    .from('ride_payments')
    .select(`${RIDE_PAYMENT_COLUMNS}, platform_fee_cents`)
    .eq('request_id', requestId)
    .eq('group_id', groupId)
    .maybeSingle();
  if (!data) return 'no_payment';
  const row = data as RidePaymentRow & { platform_fee_cents: number };
  const now = new Date().toISOString();

  if (row.payment_status === 'HOLD_PLACED' && row.stripe_payment_intent_id) {
    try {
      await stripe.paymentIntents.capture(
        row.stripe_payment_intent_id,
        { amount_to_capture: row.platform_fee_cents },
        { idempotencyKey: `floqq-cancel-fee-${row.id}` }
      );
    } catch (err) {
      console.error('cancellation fee capture failed', err);
      await adminClient
        .from('ride_payments')
        .update({
          payment_status: 'CAPTURE_FAILED',
          failure_reason: `cancellation_fee: ${(err as { code?: string }).code ?? 'capture_error'}`,
          last_status_actor: 'passenger',
        })
        .eq('id', row.id)
        .eq('payment_status', 'HOLD_PLACED');
      return 'capture_failed';
    }
    await adminClient
      .from('ride_payments')
      .update({
        payment_status: 'CAPTURED',
        final_share_cents: 0,
        captured_at: now,
        failure_reason: 'cancelled_by_passenger',
        last_status_actor: 'passenger',
      })
      .eq('id', row.id)
      .eq('payment_status', 'HOLD_PLACED');
    return 'fee_captured';
  }

  if (row.payment_status === 'HOLD_PENDING_AUTH' && row.stripe_payment_intent_id) {
    await cancelHold(stripe, row.stripe_payment_intent_id);
    await adminClient
      .from('ride_payments')
      .update({
        payment_status: 'RELEASED',
        released_at: now,
        failure_reason: 'cancelled_by_passenger',
        last_status_actor: 'passenger',
      })
      .eq('id', row.id)
      .eq('payment_status', 'HOLD_PENDING_AUTH');
    return 'released';
  }

  if (row.payment_status === 'NOT_STARTED' || row.payment_status === 'HOLD_FAILED') {
    await adminClient.from('ride_payments').update({ failure_reason: 'cancelled_by_passenger' }).eq('id', row.id);
  }
  return 'nothing_to_charge';
}
