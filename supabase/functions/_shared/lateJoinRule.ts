// Pure decision logic for a late join: may a waiting passenger be added to a group that is still
// an offer? (lateJoin.ts glues this to the database, Google Routes and the notifications.)
//
// Like groupRebalance.ts this has no Deno-touching imports, so it runs under a plain Node test
// (lateJoinRule.test.ts).

import type { DetourLimits } from './detourLimit.ts';
import { groupRejection } from './groupRebalance.ts';
import type { GroupRejection, SuggestionLike } from './groupRebalance.ts';

export type JoinMember = {
  id: string;
  arrivalAt: string;
  largeLuggageCount: number;
  maxWaitMinutes: number;
};

export type JoinRejection =
  | GroupRejection
  | { reason: 'arrival_window'; request_id: string }
  | { reason: 'share_would_rise'; request_id: string; current_cents: number; new_cents: number };

// Same pairwise rule the matching job uses when it forms a group: two passengers' arrivals may be
// no further apart than the smaller of their maximum waits.
export function arrivalsCompatible(a: JoinMember, b: JoinMember): boolean {
  const diffMinutes = Math.abs(new Date(a.arrivalAt).getTime() - new Date(b.arrivalAt).getTime()) / 60000;
  return diffMinutes <= Math.min(a.maxWaitMinutes, b.maxWaitMinutes);
}

// The enlarged group must pass every rule a group has to pass (route found, large luggage, each
// passenger's own detour and wait), and nobody already in the group may end up with a higher
// estimated share than they have now - a late join should only ever make the ride cheaper for
// the passengers who were offered it (and may have secured it) at the current price.
// `suggestion` is the enlarged group's score; `currentSharesCents` the existing members' shares.
// Returns the first rule that fails, or null when the passenger may join.
export function joinRejection(
  suggestion: SuggestionLike | null,
  existing: JoinMember[],
  newcomer: JoinMember,
  currentSharesCents: Map<string, number>,
  maxLargeLuggagePerTaxi: number,
  detourLimits: DetourLimits
): JoinRejection | null {
  const clash = existing.find((member) => !arrivalsCompatible(member, newcomer));
  if (clash) return { reason: 'arrival_window', request_id: clash.id };

  const rejection = groupRejection(suggestion, [...existing, newcomer], maxLargeLuggagePerTaxi, detourLimits);
  if (rejection) return rejection;

  for (const member of existing) {
    const current = currentSharesCents.get(member.id);
    const scored = suggestion!.members.find((m) => m.id === member.id);
    if (current == null || !scored) return { reason: 'route_lookup_failed' };
    const next = Math.round(scored.fareAmount * 100);
    if (next > current) {
      return { reason: 'share_would_rise', request_id: member.id, current_cents: current, new_cents: next };
    }
  }
  return null;
}
