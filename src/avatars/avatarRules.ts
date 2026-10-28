// The pure rules around avatars - no imports, so a plain Node test loads this file directly
// (avatarRules.test.mjs). The images themselves are in registry.ts.

// The registry entry for an id; null for a missing or unknown one (an avatar a newer app version
// added, a bad value): the caller shows the neutral default, never a broken image.
export function avatarFor<T extends { id: number }>(avatars: ReadonlyArray<T>, id: number | null | undefined): T | null {
  if (id == null || !Number.isInteger(id)) return null;
  return avatars.find((avatar) => avatar.id === id) ?? null;
}

// The one pre-selected on the sign-up step, so the passenger can simply continue.
export function randomAvatarId(ids: ReadonlyArray<number>, random: () => number = Math.random): number {
  return ids[Math.min(ids.length - 1, Math.floor(random() * ids.length))];
}
