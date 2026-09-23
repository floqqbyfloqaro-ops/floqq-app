import { BARCELONA_TAXI_TARIFFS } from '../constants';

export type FareSplitInput = {
  id: string;
  distanceKm: number;
};

export type FareSplitResult = FareSplitInput & {
  amount: number;
};

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// Tariff 2 (higher rate) applies nights (20:00-08:00) and all day Saturday/Sunday; Tariff 1
// applies weekday daytime. Evaluated in the browser/runtime's local timezone - correct as long as
// the app and its users are in Europe/Madrid, but not timezone-aware beyond that.
function isTariff2Time(date: Date): boolean {
  const day = date.getDay();
  const hour = date.getHours();
  const isWeekend = day === 0 || day === 6;
  const isNight = hour < 8 || hour >= 20;
  return isWeekend || isNight;
}

// Estimates the real metered Barcelona taxi fare for a trip of this distance departing at this
// date/time: regulated flag-fall + per-km rate for whichever tariff applies, plus the airport
// supplement (every ride here starts at the airport), floored at the regulated minimum fare.
export function calculateBarcelonaTaxiFare(distanceKm: number, rideDateTime: Date): number {
  const tariff = isTariff2Time(rideDateTime) ? BARCELONA_TAXI_TARIFFS.tariff2 : BARCELONA_TAXI_TARIFFS.tariff1;
  const metered = tariff.flagFallEur + tariff.perKmEur * distanceKm + BARCELONA_TAXI_TARIFFS.airportSupplementEur;
  return roundToCents(Math.max(metered, BARCELONA_TAXI_TARIFFS.minimumFareEur));
}

// Splits totalFare proportionally to each passenger's distance from the airport,
// so whoever is dropped off farthest away (last) pays the largest share.
export function calculateFareSplit(passengers: FareSplitInput[], totalFare: number): FareSplitResult[] {
  if (passengers.length === 0) return [];

  const sorted = [...passengers].sort((a, b) => b.distanceKm - a.distanceKm);
  const totalDistance = sorted.reduce((sum, p) => sum + p.distanceKm, 0);

  const shares = sorted.map((p) => {
    const weight = totalDistance > 0 ? p.distanceKm / totalDistance : 1 / sorted.length;
    return { ...p, amount: roundToCents(weight * totalFare) };
  });

  // Rounding to cents can leave a fraction of a cent unaccounted for.
  // Assign that remainder to the largest share (furthest passenger).
  const roundedSum = shares.reduce((sum, s) => sum + s.amount, 0);
  shares[0].amount = roundToCents(shares[0].amount + (totalFare - roundedSum));

  return shares;
}
