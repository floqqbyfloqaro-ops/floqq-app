// The cards the help assistant shows in the conversation instead of describing the passenger's
// own data in text: their ride, their payment, their refund. Built here from the database rows -
// the assistant only says which card belongs with its answer, it never writes a card's content -
// so an amount or a status can't be invented. No imports, so a plain Node test
// (helpCards.test.ts) runs it.

export type CardStatus = 'paid' | 'pending' | 'refunded' | 'released' | 'failed' | 'paid_to_taxi';
export type RideStatus = 'searching' | 'match_found' | 'confirmed' | 'on_the_way' | 'completed' | 'cancelled' | 'expired';

export type RideCard = {
  type: 'ride';
  destination: string;
  // The group's meeting time, or the passenger's own arrival.
  at: string;
  status: RideStatus;
  meetingPoint: string | null;
};

export type PaymentLine = { kind: 'fee' | 'share'; amountCents: number | null; status: CardStatus; date: string | null };
export type PaymentCard = { type: 'payment'; lines: PaymentLine[] };
export type RefundCard = { type: 'refund'; amountCents: number | null; status: 'released' | 'refunded' | 'pending' | 'none'; date: string | null };

export type HelpCard = RideCard | PaymentCard | RefundCard;
export const CARD_TYPES = ['ride', 'payment', 'refund'] as const;
export type CardType = (typeof CARD_TYPES)[number];

export type RideFacts = {
  status: string;
  destination: string;
  arrivalAt: string;
  completedAt: string | null;
  group: { status: string; meetingTime: string | null; rideStartedAt: string | null; meetingPoint: string | null } | null;
};

export function rideStatus(ride: RideFacts): RideStatus {
  if (ride.completedAt) return 'completed';
  if (ride.status === 'cancelled') return 'cancelled';
  if (ride.status === 'expired') return 'expired';
  if (!ride.group || ride.group.status === 'dissolved') return 'searching';
  if (ride.group.status === 'unconfirmed') return 'match_found';
  return ride.group.rideStartedAt ? 'on_the_way' : 'confirmed';
}

export function rideCard(ride: RideFacts): RideCard {
  return {
    type: 'ride',
    destination: ride.destination,
    at: ride.group?.meetingTime ?? ride.arrivalAt,
    status: rideStatus(ride),
    meetingPoint: ride.group?.meetingPoint ?? null,
  };
}

export type PaymentFacts = {
  payment_status: string;
  platform_fee_cents: number;
  estimated_share_cents: number | null;
  final_share_cents: number | null;
  hold_amount_cents: number | null;
  captured_cents: number | null;
  released_cents: number | null;
  captured_at: string | null;
  released_at: string | null;
  isPayer: boolean;
};

const PENDING = ['NOT_STARTED', 'HOLD_PENDING_AUTH', 'HOLD_PLACED'];

// The fee and the share, each with its real status: "Paid" only for what was actually charged.
export function paymentCard(p: PaymentFacts): PaymentCard {
  const fee = (status: CardStatus, date: string | null): PaymentLine => ({ kind: 'fee', amountCents: p.platform_fee_cents, status, date });
  const share = (status: CardStatus, amountCents: number | null, date: string | null): PaymentLine => ({ kind: 'share', amountCents, status, date });
  const estimate = p.final_share_cents ?? p.estimated_share_cents;

  if (p.payment_status === 'CAPTURED') {
    const charged = p.captured_cents ?? 0;
    const shareLine = p.isPayer
      ? share('paid_to_taxi', p.final_share_cents ?? p.estimated_share_cents, null)
      : p.final_share_cents === 0 || charged <= p.platform_fee_cents
        ? // Only the fee was charged (a late cancellation): the share was never taken.
          share('released', estimate, p.captured_at)
        : share('paid', Math.max(0, charged - p.platform_fee_cents), p.captured_at);
    return { type: 'payment', lines: [fee('paid', p.captured_at), shareLine] };
  }
  if (p.payment_status === 'REFUNDED') {
    return { type: 'payment', lines: [fee('refunded', null), share('refunded', estimate, null)] };
  }
  if (p.payment_status === 'RELEASED') {
    return { type: 'payment', lines: [fee('released', p.released_at), share('released', estimate, p.released_at)] };
  }
  if (p.payment_status === 'CAPTURE_FAILED' || p.payment_status === 'HOLD_FAILED') {
    return { type: 'payment', lines: [fee('failed', null), share(p.isPayer ? 'paid_to_taxi' : 'failed', estimate, null)] };
  }
  // Reserved (or about to be), charged after the ride.
  return {
    type: 'payment',
    lines: [fee('pending', null), share(p.isPayer ? 'paid_to_taxi' : 'pending', estimate, null)],
  };
}

// What comes back to the passenger: the part of the reservation that was released (or refunded).
export function refundCard(p: PaymentFacts | null): RefundCard {
  if (!p) return { type: 'refund', amountCents: null, status: 'none', date: null };
  if (p.payment_status === 'REFUNDED') return { type: 'refund', amountCents: p.captured_cents, status: 'refunded', date: null };
  if (p.payment_status === 'RELEASED') {
    return { type: 'refund', amountCents: p.released_cents ?? p.hold_amount_cents, status: 'released', date: p.released_at };
  }
  if (p.payment_status === 'CAPTURED') {
    return (p.released_cents ?? 0) > 0
      ? { type: 'refund', amountCents: p.released_cents, status: 'released', date: p.captured_at }
      : { type: 'refund', amountCents: 0, status: 'none', date: null };
  }
  if (PENDING.includes(p.payment_status)) return { type: 'refund', amountCents: null, status: 'pending', date: null };
  return { type: 'refund', amountCents: null, status: 'none', date: null };
}

// The screens an answer can open. The app maps each to a screen; none of them changes anything by
// itself - cancelling or changing a card happens on that screen, with its usual confirmation.
export const HELP_ACTIONS = ['open_my_ride', 'edit_ride', 'cancel_ride', 'payment_methods', 'show_badge', 'location_settings'] as const;
export type HelpAction = (typeof HELP_ACTIONS)[number];

export function parseHelpAction(value: unknown): HelpAction | null {
  return HELP_ACTIONS.includes(value as HelpAction) ? (value as HelpAction) : null;
}
