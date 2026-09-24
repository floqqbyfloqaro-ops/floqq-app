// The per-passenger detour rule for the app (admin "Suggest groups" in matchingEngine.ts).
// Mirror of supabase/functions/_shared/detourLimit.ts, which the Edge Functions use - keep both
// in sync.
//
// Each passenger's own extra time (vs. driving straight to their destination) must stay within
// the smaller of an absolute cap and a percentage of their direct trip, but never below a small
// floor so short trips can still be shared. Checked per passenger - a group is never approved
// on its average detour.

export type DetourLimits = {
  maxMinutes: number;
  maxPercent: number;
  minAllowedMinutes: number;
};

export function allowedDetourMinutes(directMinutes: number | null | undefined, limits: DetourLimits): number {
  // Direct time unknown (route lookup failed for this leg): fall back to the absolute cap alone.
  if (directMinutes == null || !Number.isFinite(directMinutes)) return limits.maxMinutes;
  const relativeCap = (directMinutes * limits.maxPercent) / 100;
  return Math.max(limits.minAllowedMinutes, Math.min(limits.maxMinutes, relativeCap));
}

export function exceedsDetourLimit(
  member: { extraDetourMinutes: number; directMinutes?: number | null },
  limits: DetourLimits
): boolean {
  return member.extraDetourMinutes > allowedDetourMinutes(member.directMinutes, limits);
}
