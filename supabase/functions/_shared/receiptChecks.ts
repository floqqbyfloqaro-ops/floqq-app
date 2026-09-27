// Pure anti-fraud rules for the payments prototype's taxi receipt (phase 5). The amount and date
// always come from the photo (read by Claude in receiptScan.ts), never from what the payer types,
// and a receipt is only accepted automatically when it clearly belongs to this ride. Anything
// doubtful goes to the admin instead of being paid out. No Deno or network imports, so it runs
// under the plain Node test in receiptChecks.test.ts. All amounts are integer cents, EUR.

import { isValidReceiptTotal } from './receiptMath.ts';

const MINUTE_MS = 60_000;

// A receipt is printed at the end of the ride. Flights can land early, so the window opens a bit
// before the first passenger's arrival; it closes a few hours after the planned departure to
// allow for delays and traffic.
export const RECEIPT_WINDOW_BEFORE_FIRST_ARRIVAL_MINUTES = 60;
export const RECEIPT_WINDOW_AFTER_DEPARTURE_MINUTES = 6 * 60;
// Clock differences between the taximeter and our server.
export const RECEIPT_FUTURE_TOLERANCE_MINUTES = 10;

// A metered fare this far above the group's estimate goes to the admin: 50% more, plus EUR 10.
export const AMOUNT_ABOVE_ESTIMATE_PERCENT = 50;
export const AMOUNT_ABOVE_ESTIMATE_SLACK_CENTS = 1000;

// What Claude read off the photo. Strings are '' when the field isn't on the receipt or can't be read.
export type ReceiptScan = {
  readable: boolean;
  isTaxiReceipt: boolean;
  totalEur: string;
  // YYYY-MM-DD and HH:MM (24h), as printed - local Barcelona time.
  date: string;
  time: string;
  taxiLicence: string;
  receiptNumber: string;
};

export type ReviewReason =
  | 'no_date'
  | 'date_outside_ride'
  | 'date_in_future'
  | 'duplicate_receipt'
  | 'duplicate_photo'
  | 'amount_above_estimate';

export type ReceiptVerdict =
  | { outcome: 'UNREADABLE'; reason: 'unreadable' | 'not_a_taxi_receipt' | 'no_total' }
  | {
      outcome: 'ACCEPTED' | 'NEEDS_REVIEW';
      totalCents: number;
      receiptAtMs: number | null;
      reasons: ReviewReason[];
    };

export type RideContext = {
  arrivalTimes: string[];
  departureMs: number;
  nowMs: number;
  // taxi_groups.total_fare in cents, or null if there's no estimate.
  estimatedFareCents: number | null;
  // Another group already has a receipt with this licence + receipt number / this exact photo.
  duplicateReceipt: boolean;
  duplicatePhoto: boolean;
};

// "38,50" / "38.50" / "€ 38.5" / "1.038,50" -> cents, or null.
export function parseReceiptTotal(input: string): number | null {
  let s = input.replace(/[€\s]|EUR/gi, '');
  if (!s) return null;
  // A comma decimal separator (Spanish receipts): drop thousands dots first.
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

// Offset of Europe/Madrid from UTC at the given instant, in ms (+1h in winter, +2h in summer).
function madridOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// A wall-clock date and time printed on a Barcelona receipt -> the UTC instant, or null.
export function madridLocalToUtcMs(date: string, time: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [year, month, day, hour, minute] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset, including right around the DST switch.
  let utc = wall - madridOffsetMs(wall);
  utc = wall - madridOffsetMs(utc);
  return utc;
}

export function evaluateReceipt(scan: ReceiptScan, ride: RideContext): ReceiptVerdict {
  if (!scan.readable) return { outcome: 'UNREADABLE', reason: 'unreadable' };
  if (!scan.isTaxiReceipt) return { outcome: 'UNREADABLE', reason: 'not_a_taxi_receipt' };
  const totalCents = parseReceiptTotal(scan.totalEur);
  if (totalCents == null || !isValidReceiptTotal(totalCents)) return { outcome: 'UNREADABLE', reason: 'no_total' };

  const reasons: ReviewReason[] = [];

  const receiptAtMs = madridLocalToUtcMs(scan.date, scan.time);
  if (receiptAtMs == null) {
    reasons.push('no_date');
  } else {
    const firstArrivalMs = Math.min(...ride.arrivalTimes.map((a) => new Date(a).getTime()));
    const opensMs = firstArrivalMs - RECEIPT_WINDOW_BEFORE_FIRST_ARRIVAL_MINUTES * MINUTE_MS;
    const closesMs = ride.departureMs + RECEIPT_WINDOW_AFTER_DEPARTURE_MINUTES * MINUTE_MS;
    if (receiptAtMs > ride.nowMs + RECEIPT_FUTURE_TOLERANCE_MINUTES * MINUTE_MS) reasons.push('date_in_future');
    else if (receiptAtMs < opensMs || receiptAtMs > closesMs) reasons.push('date_outside_ride');
  }

  if (ride.duplicateReceipt) reasons.push('duplicate_receipt');
  if (ride.duplicatePhoto) reasons.push('duplicate_photo');

  if (ride.estimatedFareCents != null) {
    const limit =
      Math.round((ride.estimatedFareCents * (100 + AMOUNT_ABOVE_ESTIMATE_PERCENT)) / 100) + AMOUNT_ABOVE_ESTIMATE_SLACK_CENTS;
    if (totalCents > limit) reasons.push('amount_above_estimate');
  }

  return { outcome: reasons.length ? 'NEEDS_REVIEW' : 'ACCEPTED', totalCents, receiptAtMs, reasons };
}
