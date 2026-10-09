// Which meeting point does a confirmed group get? Pure decision logic (meetingPoints.ts glues it
// to the database):
//   - only active points at the group's terminal - T2 groups meet at the T2B points;
//   - not a point another group is using around the same time, so two groups never stand at the
//     same landmark at once;
//   - the highest priority among the free ones;
//   - when every point is taken: the least crowded one (the groups then tell each other apart by
//     their badge).
// Meeting points are landmarks, not venues: whether a café is open plays no part.
//
// No Deno-touching imports, so this runs under a plain Node test.

export type AssignablePoint = {
  id: string;
  // 'T1', 'T2A', 'T2B' or 'T2C'.
  terminal: string;
  shortCode: string;
  sortPriority: number;
  isActive: boolean;
};

// A point another group already has, and when that group meets there.
export type ExistingAssignment = { meetingPointId: string; meetingTimeMs: number };

const MINUTE_MS = 60_000;

// Where a group arriving at this terminal meets. All of T2 (T2A, T2B, T2C) uses the T2B points.
export function meetingTerminalFor(arrivalTerminal: string): string | null {
  if (arrivalTerminal === 'T1') return 'T1';
  if (arrivalTerminal.startsWith('T2')) return 'T2B';
  return null;
}

// Two groups are at a point "at the same time" when their meeting times are no further apart
// than the window.
export function overlappingGroups(
  pointId: string,
  meetingTimeMs: number,
  others: ExistingAssignment[],
  windowMinutes: number
): number {
  return others.filter(
    (other) => other.meetingPointId === pointId && Math.abs(other.meetingTimeMs - meetingTimeMs) <= windowMinutes * MINUTE_MS
  ).length;
}

export type PointChoice = {
  point: AssignablePoint;
  // How many other groups meet there within the window: 0 unless every point was taken.
  overlapping: number;
};

// Null when the terminal has no active point at all.
export function pickMeetingPoint(
  points: AssignablePoint[],
  arrivalTerminal: string,
  meetingTimeMs: number,
  others: ExistingAssignment[],
  windowMinutes: number
): PointChoice | null {
  const terminal = meetingTerminalFor(arrivalTerminal);
  if (!terminal) return null;

  const choices = points
    .filter((point) => point.isActive && point.terminal === terminal)
    .map((point) => ({ point, overlapping: overlappingGroups(point.id, meetingTimeMs, others, windowMinutes) }))
    .sort(
      (a, b) =>
        a.overlapping - b.overlapping ||
        b.point.sortPriority - a.point.sortPriority ||
        a.point.shortCode.localeCompare(b.point.shortCode)
    );

  return choices[0] ?? null;
}
