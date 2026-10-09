// The same-terminal rule: a taxi group only holds passengers arriving at the same terminal. T1
// and T2 are kilometres apart; T2A, T2B and T2C are one terminal for this purpose (T2).
//
// No Deno-touching imports, so this runs under a plain Node test.

export type ArrivalTerminal = 'T1' | 'T2';

// Whatever a source calls the terminal ("1", "T1", "2B", "Terminal 2", "T2A") -> T1, T2 or null
// when it isn't one of Barcelona's.
export function normalizeTerminal(raw: unknown): ArrivalTerminal | null {
  if (typeof raw !== 'string') return null;
  const value = raw
    .trim()
    .toUpperCase()
    .replace(/^TERMINAL\s*/, '')
    .replace(/^T\s*/, '');
  if (value === '1') return 'T1';
  if (/^2[ABC]?$/.test(value)) return 'T2';
  return null;
}

// Two passengers may share a group only when both terminals are known and equal: an unknown
// terminal never matches anything.
export function sameTerminal(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && a === b;
}
