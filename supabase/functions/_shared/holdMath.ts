// Pure amount/timing rules for the payments prototype's card holds (phase 3). No Deno or network
// imports, so it runs under the plain Node test in holdMath.test.ts. All amounts are integer
// cents, EUR.

import { GROUP_DEPARTURE_BUFFER_MINUTES, SERVICE_FEE_EUR } from './constants.ts';
import { calculateFareSplit } from './fareSplit.ts';

// FLOQQ platform fee, included in every hold and captured with the passenger's share after the
// ride (one card transaction instead of two).
export const PLATFORM_FEE_CENTS = Math.round(SERVICE_FEE_EUR * 100);

// Buffer on top of the estimated share, so a real metered fare above the estimate can still be
// captured (Stripe can never capture more than was held): 25%, at least EUR 5.
export const HOLD_BUFFER_PERCENT = 25;
export const HOLD_BUFFER_MIN_CENTS = 500;

// A card hold placed with the passenger in the app lasts 7 days. Opening the hold no earlier than
// 5 days before the ride leaves at least 2 days for the ride, the receipt and the dispute window.
export const HOLD_LEAD_DAYS = 5;

// How long a passenger has to place (or fix) their hold once it can be placed - never later than
// HOLD_DEADLINE_BEFORE_RIDE_MINUTES before the ride, but always at least HOLD_MIN_WINDOW_MINUTES.
export const HOLD_WINDOW_MINUTES = 60;
export const HOLD_DEADLINE_BEFORE_RIDE_MINUTES = 30;
export const HOLD_MIN_WINDOW_MINUTES = 15;

const MINUTE_MS = 60_000;

export type HoldMember = { id: string; distanceKm: number };

export function holdAmountCents(estimatedShareCents: number): number {
  const buffer = Math.max(Math.round((estimatedShareCents * HOLD_BUFFER_PERCENT) / 100), HOLD_BUFFER_MIN_CENTS);
  return estimatedShareCents + PLATFORM_FEE_CENTS + buffer;
}

// Each member's estimated share in cents, from the existing distance-proportional fare split.
// totalFareEur is taxi_groups.total_fare (euros, as stored today).
export function estimatedSharesCents(members: HoldMember[], totalFareEur: number): Map<string, number> {
  const shares = calculateFareSplit(members, totalFareEur);
  return new Map(shares.map((s) => [s.id, Math.round(s.amount * 100)]));
}

// Same departure the matching engine assumes: the last member's arrival plus the curb buffer.
export function rideDepartureMs(arrivalTimes: string[]): number {
  const latestArrivalMs = Math.max(...arrivalTimes.map((a) => new Date(a).getTime()));
  return latestArrivalMs + GROUP_DEPARTURE_BUFFER_MINUTES * MINUTE_MS;
}

export function holdWindow(rideMs: number, nowMs: number): { opensAt: Date; deadlineAt: Date } {
  const opensMs = Math.max(nowMs, rideMs - HOLD_LEAD_DAYS * 24 * 60 * MINUTE_MS);
  const deadlineMs = Math.max(
    opensMs + HOLD_MIN_WINDOW_MINUTES * MINUTE_MS,
    Math.min(opensMs + HOLD_WINDOW_MINUTES * MINUTE_MS, rideMs - HOLD_DEADLINE_BEFORE_RIDE_MINUTES * MINUTE_MS)
  );
  return { opensAt: new Date(opensMs), deadlineAt: new Date(deadlineMs) };
}

// Whether a hold that's already placed still covers a (possibly increased) share plus the fee.
export function holdCovers(holdCents: number, estimatedShareCents: number): boolean {
  return holdCents >= estimatedShareCents + PLATFORM_FEE_CENTS;
}
