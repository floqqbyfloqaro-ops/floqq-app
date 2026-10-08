// Keeps a confirmed group's ride_payments rows (one per passenger) in step with its membership,
// and releases holds that no longer belong to an active group member. Used by
// payments-sync-holds (admin "confirm" + the 5-minute cron job). Every payment_status change
// is written to payment_events by the ride_payments trigger; last_status_actor says who did it.
//
// A group that is still an offer (unconfirmed, "Match found") can already have holds: a passenger
// who taps "Secure my spot" gets their row from the secure-spot function and places the hold
// right away. Those rows are kept in step here too, but none are created for passengers who
// haven't answered.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17';

import { sendPush } from './push.ts';
import {
  estimatedSharesCents,
  holdAmountCents,
  holdCovers,
  holdTransition,
  holdWindow,
  PLATFORM_FEE_CENTS,
  rideDepartureMs,
} from './holdMath.ts';
import { freeCancelUntilMs } from './settlementMath.ts';

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
  hold_open_notified_at: string | null;
  ended_notified_at: string | null;
  free_cancel_until: string | null;
};

export const RIDE_PAYMENT_COLUMNS =
  'id, request_id, group_id, user_id, estimated_share_cents, hold_amount_cents, stripe_payment_intent_id, payment_status, hold_deadline_at, hold_open_notified_at, ended_notified_at, free_cancel_until';

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

// Money has already moved (or failed to): the passenger is told about that separately.
const FINAL_STATUSES = ['CAPTURED', 'CAPTURE_FAILED', 'REFUNDED'];

type NotifiedColumn = 'hold_open_notified_at' | 'hold_reminder_sent_at' | 'ended_notified_at' | 'settled_notified_at';

// Claims a one-time notification for a row: true only for the single caller that set it.
export async function markNotified(adminClient: SupabaseClient, rowId: string, column: NotifiedColumn): Promise<boolean> {
  const { data } = await adminClient
    .from('ride_payments')
    .update({ [column]: new Date().toISOString() })
    .eq('id', rowId)
    .is(column, null)
    .select('id');
  return (data?.length ?? 0) > 0;
}

// Records that a passenger secured their spot in the group offered to them ("Match found"):
// right away when no hold is needed yet, otherwise the moment their hold is placed. Only counts
// while they are in that group, and only once per group (audit event spot_secured).
export async function markSpotSecured(adminClient: SupabaseClient, requestId: string, groupId: string): Promise<boolean> {
  const { data } = await adminClient
    .from('passenger_requests')
    .update({ spot_secured_at: new Date().toISOString(), spot_secured_group_id: groupId })
    .eq('id', requestId)
    .eq('group_id', groupId)
    .or(`spot_secured_group_id.is.null,spot_secured_group_id.neq.${groupId}`)
    .select('id, user_id');
  if (!data?.length) return false;

  await adminClient.from('group_events').insert({
    group_id: groupId,
    request_id: requestId,
    event_type: 'spot_secured',
    actor_type: 'passenger',
    actor_id: data[0].user_id,
  });
  return true;
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
  // Still an offer: only passengers who tapped "Secure my spot" have a row.
  const isOffer = group.status === 'unconfirmed';
  const groupActive = group.status === 'confirmed' || isOffer;

  // Release holds of passengers who are no longer in this (still active) group.
  for (const row of rows) {
    const stillMember = groupActive && row.request_id != null && memberIds.has(row.request_id);
    if (stillMember) continue;

    if (OPEN_HOLD_STATUSES.includes(row.payment_status) && row.stripe_payment_intent_id) {
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

    // Tell passengers of a dissolved group, once. (A passenger removed after missing the deadline
    // or who cancelled themselves is already marked - see removeMissedDeadlines/settleCancelledSeat.)
    if (!groupActive && !row.ended_notified_at && row.user_id && !FINAL_STATUSES.includes(row.payment_status)) {
      if (await markNotified(adminClient, row.id, 'ended_notified_at')) {
        await sendPush(adminClient, { userId: row.user_id, key: 'groupDissolved' });
      }
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
  const freeCancelUntil = new Date(freeCancelUntilMs(rideMs)).toISOString();

  for (const member of members) {
    const shareCents = shares.get(member.id)!;
    const holdCents = holdAmountCents(shareCents);
    const row = rowByRequest.get(member.id);

    if (!row) {
      if (isOffer) continue;
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
          free_cancel_until: freeCancelUntil,
          last_status_actor: 'system',
        },
        { onConflict: 'request_id,group_id', ignoreDuplicates: true }
      );
      continue;
    }

    // The ride time moves when the group changes, and with it the free-cancellation cutoff.
    if (row.free_cancel_until == null || new Date(row.free_cancel_until).getTime() !== new Date(freeCancelUntil).getTime()) {
      await adminClient.from('ride_payments').update({ free_cancel_until: freeCancelUntil }).eq('id', row.id);
    }

    // A row from the offer that never got its hold (e.g. a declined card) was never given the
    // usual "reserve your seat" window - it gets one now that the group is confirmed.
    if (
      !isOffer &&
      row.hold_open_notified_at == null &&
      (row.payment_status === 'NOT_STARTED' || row.payment_status === 'HOLD_FAILED')
    ) {
      const { opensAt, deadlineAt } = holdWindow(rideMs, now.getTime());
      if (row.hold_deadline_at == null || new Date(row.hold_deadline_at).getTime() < deadlineAt.getTime()) {
        await adminClient
          .from('ride_payments')
          .update({ hold_window_opens_at: opensAt.toISOString(), hold_deadline_at: deadlineAt.toISOString() })
          .eq('id', row.id)
          .eq('payment_status', row.payment_status);
      }
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
          // Send "reserve the new amount" (and its reminder) for the new window.
          hold_open_notified_at: null,
          hold_reminder_sent_at: null,
          last_status_actor: 'system',
        })
        .eq('id', row.id)
        .eq('payment_status', row.payment_status);

      // In an offer the spot was secured by that hold: they secure it again for the new amount.
      if (isOffer) {
        await adminClient
          .from('passenger_requests')
          .update({ spot_secured_at: null, spot_secured_group_id: null })
          .eq('id', member.id)
          .eq('spot_secured_group_id', groupId);
      }
    }
  }

  return { groupId, outcome: 'synced' };
}

type StatusActor = 'passenger' | 'system' | 'stripe';

// Reads the hold's current state straight from Stripe and applies it to its ride_payments row.
// Both payments-place-hold (right after creating the hold) and stripe-webhook call this, always
// with a freshly retrieved PaymentIntent - never with a client's word for it - so a repeated or
// out-of-order event just re-applies the current state (see holdTransition in holdMath.ts).
export async function applyHoldState(
  adminClient: SupabaseClient,
  stripe: Stripe,
  paymentIntentId: string,
  actor: StatusActor
): Promise<{ status: string | null; changed: boolean }> {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] });
  const ridePaymentId = intent.metadata?.ride_payment_id;
  if (!ridePaymentId) return { status: null, changed: false }; // Not a ride hold (e.g. the old service-fee Checkout).

  const { data: row } = await adminClient
    .from('ride_payments')
    .select('id, request_id, group_id, payment_status, stripe_payment_intent_id, hold_attempts, hold_amount_cents')
    .eq('id', ridePaymentId)
    .single();
  if (!row) return { status: null, changed: false };

  // The row moved on to another attempt. If this orphan still holds money, release it - FLOQQ
  // never keeps a hold it doesn't track.
  const isCurrent =
    row.stripe_payment_intent_id === intent.id ||
    (row.stripe_payment_intent_id == null && String(row.hold_attempts) === intent.metadata?.attempt);
  if (!isCurrent) {
    if (intent.status === 'requires_capture' || intent.status === 'requires_action') {
      await cancelHold(stripe, intent.id);
    }
    return { status: row.payment_status, changed: false };
  }

  const to = holdTransition(intent.status, row.payment_status);
  if (!to) {
    return { status: row.payment_status, changed: false };
  }

  const update: Record<string, unknown> = {
    payment_status: to,
    stripe_payment_intent_id: intent.id,
    last_status_actor: actor,
  };

  if (to === 'CAPTURED') {
    // Same bookkeeping as the settlement's own capture (settlement.ts), which finishes the rest.
    const charge = intent.latest_charge as Stripe.Charge | null;
    update.captured_at = new Date().toISOString();
    update.captured_cents = intent.amount_received;
    update.released_cents = row.hold_amount_cents - intent.amount_received;
    update.stripe_charge_id = charge?.id ?? null;
  } else if (to === 'HOLD_PLACED') {
    const charge = intent.latest_charge as Stripe.Charge | null;
    const captureBefore = charge?.payment_method_details?.card?.capture_before;
    update.hold_placed_at = new Date().toISOString();
    update.hold_expires_at = captureBefore ? new Date(captureBefore * 1000).toISOString() : null;
    update.failure_reason = null;
  } else if (to === 'HOLD_FAILED') {
    const lastError = intent.last_payment_error;
    update.failure_reason = lastError?.decline_code ?? lastError?.code ?? 'payment_failed';
  } else if (to === 'RELEASED') {
    update.released_at = new Date().toISOString();
    update.failure_reason = intent.cancellation_reason === 'automatic' ? 'hold_expired' : intent.cancellation_reason;
  }

  const { data: updated } = await adminClient
    .from('ride_payments')
    .update(update)
    .eq('id', row.id)
    .eq('payment_status', row.payment_status)
    .select('payment_status');

  const changed = (updated?.length ?? 0) > 0 && to !== row.payment_status;

  // A placed hold is what secures the passenger's spot in a group that's still an offer.
  if ((updated?.length ?? 0) > 0 && to === 'HOLD_PLACED' && row.request_id && row.group_id) {
    await markSpotSecured(adminClient, row.request_id, row.group_id);
  }

  return { status: updated?.[0]?.payment_status ?? row.payment_status, changed };
}

// A passenger cancelled their ride after the group was confirmed. With a placed hold:
//   - up to FREE_CANCELLATION_HOURS before the ride (free_cancel_until), the whole hold is released
//     - nothing is charged, fee included;
//   - later, FLOQQ keeps only the platform fee: capturing less than the hold releases the rest
//     automatically, in one transaction.
// A hold still waiting for 3D Secure is simply cancelled (nothing is charged), and without a hold
// there is nothing to charge. A failed capture never blocks the cancellation - it is recorded as
// CAPTURE_FAILED with the fee outstanding, for the admin. A webhook may record the capture or the
// release first, so the final updates accept that status too.
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

  // They cancelled themselves - no "group dissolved" push for this seat.
  await markNotified(adminClient, row.id, 'ended_notified_at');

  const isFree = row.free_cancel_until != null && Date.now() < new Date(row.free_cancel_until).getTime();

  if (row.payment_status === 'HOLD_PLACED' && row.stripe_payment_intent_id && isFree) {
    await cancelHold(stripe, row.stripe_payment_intent_id);
    await adminClient
      .from('ride_payments')
      .update({
        payment_status: 'RELEASED',
        released_at: now,
        released_cents: row.hold_amount_cents,
        failure_reason: 'cancelled_free',
        last_status_actor: 'passenger',
      })
      .eq('id', row.id)
      .in('payment_status', ['HOLD_PLACED', 'RELEASED']);
    return 'released_free';
  }

  if (row.payment_status === 'HOLD_PLACED' && row.stripe_payment_intent_id) {
    let capturedCents = row.platform_fee_cents;
    try {
      const intent = await stripe.paymentIntents.capture(
        row.stripe_payment_intent_id,
        { amount_to_capture: row.platform_fee_cents },
        { idempotencyKey: `floqq-cancel-fee-${row.id}` }
      );
      capturedCents = intent.amount_received;
    } catch (err) {
      console.error('cancellation fee capture failed', err);
      await adminClient
        .from('ride_payments')
        .update({
          payment_status: 'CAPTURE_FAILED',
          failure_reason: `cancellation_fee: ${(err as { code?: string }).code ?? 'capture_error'}`,
          outstanding_cents: row.platform_fee_cents,
          outstanding_reason: 'cancellation_fee',
          outstanding_since: now,
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
        captured_cents: capturedCents,
        released_cents: row.hold_amount_cents - capturedCents,
        failure_reason: 'cancelled_by_passenger',
        last_status_actor: 'passenger',
      })
      .eq('id', row.id)
      .in('payment_status', ['HOLD_PLACED', 'CAPTURED']);
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

// Sends the time-based hold notifications that are due: "reserve your seat" once the window is
// open (or "reserve the new amount" after the share went up), and a reminder in the last
// REMINDER_BEFORE_DEADLINE_MINUTES. Each goes out once per window (markNotified), and only to
// passengers still in the confirmed group the row belongs to.
const REMINDER_BEFORE_DEADLINE_MINUTES = 15;
const MINUTE_MS = 60_000;

type DueRow = {
  id: string;
  request_id: string | null;
  group_id: string | null;
  user_id: string | null;
  hold_amount_cents: number;
  failure_reason: string | null;
  hold_window_opens_at: string | null;
  hold_deadline_at: string | null;
};

const DUE_COLUMNS =
  'id, request_id, group_id, user_id, hold_amount_cents, failure_reason, hold_window_opens_at, hold_deadline_at';

async function isActiveMember(adminClient: SupabaseClient, row: DueRow): Promise<boolean> {
  if (!row.request_id || !row.group_id) return false;
  const { data: request } = await adminClient.from('passenger_requests').select('group_id').eq('id', row.request_id).single();
  if (request?.group_id !== row.group_id) return false;
  const { data: group } = await adminClient.from('taxi_groups').select('status').eq('id', row.group_id).single();
  return group?.status === 'confirmed';
}

export async function sendDueHoldNotifications(adminClient: SupabaseClient, now = new Date(), groupId?: string) {
  const nowIso = now.toISOString();

  let openQuery = adminClient
    .from('ride_payments')
    .select(DUE_COLUMNS)
    .in('payment_status', ['NOT_STARTED', 'HOLD_FAILED'])
    .is('hold_open_notified_at', null)
    .lte('hold_window_opens_at', nowIso)
    .gt('hold_deadline_at', nowIso);
  if (groupId) openQuery = openQuery.eq('group_id', groupId);
  const { data: openRows } = await openQuery;

  for (const row of (openRows ?? []) as DueRow[]) {
    if (!row.user_id || !(await isActiveMember(adminClient, row))) continue;
    if (!(await markNotified(adminClient, row.id, 'hold_open_notified_at'))) continue;
    await sendPush(adminClient, {
      userId: row.user_id,
      key: row.failure_reason === 'share_increased' ? 'holdOpenShareIncreased' : 'holdOpen',
      amountCents: row.hold_amount_cents,
      timeIso: row.hold_deadline_at,
    });
  }

  let reminderQuery = adminClient
    .from('ride_payments')
    .select(DUE_COLUMNS)
    .in('payment_status', ['NOT_STARTED', 'HOLD_FAILED', 'HOLD_PENDING_AUTH'])
    .is('hold_reminder_sent_at', null)
    .not('hold_open_notified_at', 'is', null)
    .gt('hold_deadline_at', nowIso)
    .lte('hold_deadline_at', new Date(now.getTime() + REMINDER_BEFORE_DEADLINE_MINUTES * MINUTE_MS).toISOString());
  if (groupId) reminderQuery = reminderQuery.eq('group_id', groupId);
  const { data: reminderRows } = await reminderQuery;

  for (const row of (reminderRows ?? []) as DueRow[]) {
    // A window that only just opened (and was just announced) doesn't need a reminder on top.
    const opensMs = row.hold_window_opens_at ? new Date(row.hold_window_opens_at).getTime() : 0;
    if (now.getTime() - opensMs < 5 * MINUTE_MS) continue;
    if (!row.user_id || !(await isActiveMember(adminClient, row))) continue;
    if (!(await markNotified(adminClient, row.id, 'hold_reminder_sent_at'))) continue;
    await sendPush(adminClient, { userId: row.user_id, key: 'holdReminder', timeIso: row.hold_deadline_at });
  }
}
