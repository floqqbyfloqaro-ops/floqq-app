// Which badge does a confirmed group get? A colour (each with its own shape in the app) and a
// two-digit number, held up on the phone so the members recognise each other. Pure decision logic
// (meetingPoints.ts glues it to the database):
//   - colour + number is unique among the groups at the same terminal that meet around the same
//     time, so two groups never show the same badge in the same place;
//   - colour is what is seen from afar, so groups sent to the same meeting point get different
//     colours first, and groups elsewhere in the terminal too while colours last;
//   - a badge is chosen once and never changed: members may already have seen it.
//
// No Deno-touching imports, so this runs under a plain Node test.

export const BADGE_COLORS = ['purple', 'teal', 'orange', 'pink', 'yellow', 'blue'] as const;
export type BadgeColor = (typeof BADGE_COLORS)[number];

export const BADGE_NUMBER_MIN = 10;
export const BADGE_NUMBER_MAX = 99;

export type Badge = { color: BadgeColor; number: number };

// Another group at the same terminal that already has its badge.
export type ExistingBadge = Badge & { meetingPointId: string | null; meetingTimeMs: number };

const MINUTE_MS = 60_000;

// Returns a number in [0, 1), like Math.random - passed in so tests can fix it.
export type Random = () => number;

function shuffled<T>(items: readonly T[], random: Random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// `others` must only hold groups at the same terminal. Null only if every colour and number is
// taken around that time (540 groups at one terminal within the window).
export function pickBadge(
  others: ExistingBadge[],
  meetingPointId: string | null,
  meetingTimeMs: number,
  windowMinutes: number,
  random: Random = Math.random
): Badge | null {
  const overlapping = others.filter((other) => Math.abs(other.meetingTimeMs - meetingTimeMs) <= windowMinutes * MINUTE_MS);
  const samePoint = overlapping.filter((other) => meetingPointId != null && other.meetingPointId === meetingPointId);

  const uses = (groups: ExistingBadge[], color: BadgeColor) => groups.filter((g) => g.color === color).length;

  // Least used at this group's own meeting point first, then least used in the whole terminal;
  // the shuffle beforehand breaks ties at random, so badges don't always start at purple.
  const colors = shuffled(BADGE_COLORS, random).sort(
    (a, b) => uses(samePoint, a) - uses(samePoint, b) || uses(overlapping, a) - uses(overlapping, b)
  );

  const numbers = Array.from({ length: BADGE_NUMBER_MAX - BADGE_NUMBER_MIN + 1 }, (_, i) => BADGE_NUMBER_MIN + i);
  for (const color of colors) {
    const takenNumbers = new Set(overlapping.filter((g) => g.color === color).map((g) => g.number));
    const number = shuffled(numbers, random).find((candidate) => !takenNumbers.has(candidate));
    if (number != null) return { color, number };
  }
  return null;
}
