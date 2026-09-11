// Ported verbatim from src/services/fareSplit.ts for the Deno Edge Function runtime.
// Keep both copies in sync - this is pure logic with zero runtime-specific dependencies.

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
