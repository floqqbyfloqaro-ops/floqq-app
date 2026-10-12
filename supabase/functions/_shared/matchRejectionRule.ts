// The matching job's memory of combinations it already turned down. Scoring a combination of
// passengers is a paid Google Routes lookup: if the job runs more often than a rejection is worth
// re-asking, a pair that is close but doesn't fit would be paid for again on every run.
//
// A rejected combination is not asked about again until
//   - MATCH_REJECTION_RECHECK_MINUTES have passed (routes are traffic-aware, so the answer can
//     change), or
//   - something about it changed: a member's arrival or ready time, destination or luggage, or (for a
//     passenger joining an open offer) the offer itself.
// Only real rejections are remembered - never a lookup that failed.
//
// No Deno-touching imports, so this runs under a plain Node test.

export type RejectionKind = 'new' | 'join';

export type RejectionRow = { group_key: string; fingerprint: string; rejected_at: string };

type Member = {
  id: string;
  arrival_at: string;
  ready_at?: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  large_luggage_count: number;
  max_wait_minutes: number;
};

// The same passengers in any order are the same combination.
export function rejectionKey(kind: RejectionKind, memberIds: string[]): string {
  return `${kind}:${[...memberIds].sort().join(',')}`;
}

// Everything about a combination that its rejection depended on. `extra` is for what isn't a
// member's own: the version and fare of the offer a passenger would join.
export function rejectionFingerprint(members: Member[], extra = ''): string {
  const parts = [...members]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) =>
      [m.id, m.arrival_at, m.ready_at ?? '', m.destination_lat, m.destination_lng, m.large_luggage_count, m.max_wait_minutes].join('|')
    );
  return [...parts, extra].join(';');
}

export type RejectionMemory = {
  // Turned down recently, and nothing about it has changed since.
  isRejected: (key: string, fingerprint: string) => boolean;
  reject: (key: string, fingerprint: string) => void;
  // The rejections made through this memory, to be stored.
  added: () => RejectionRow[];
};

export function createRejectionMemory(rows: RejectionRow[], nowMs: number, recheckMinutes: number): RejectionMemory {
  const sinceMs = nowMs - recheckMinutes * 60_000;
  const known = new Map<string, string>();
  for (const row of rows) {
    if (new Date(row.rejected_at).getTime() > sinceMs) known.set(row.group_key, row.fingerprint);
  }
  const added = new Map<string, RejectionRow>();

  return {
    isRejected: (key, fingerprint) => known.get(key) === fingerprint,
    reject: (key, fingerprint) => {
      known.set(key, fingerprint);
      added.set(key, { group_key: key, fingerprint, rejected_at: new Date(nowMs).toISOString() });
    },
    added: () => [...added.values()],
  };
}
