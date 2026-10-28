// Run with: node --experimental-strip-types --test src/avatars/avatarRules.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { avatarFor, randomAvatarId } from './avatarRules.ts';

const AVATARS = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, source: `avatar-${id}` }));

test('a known id gives its avatar', () => {
  assert.equal(avatarFor(AVATARS, 1)?.source, 'avatar-1');
  assert.equal(avatarFor(AVATARS, 8)?.source, 'avatar-8');
});

test('a missing, unknown or malformed id gives no avatar (the neutral default is shown)', () => {
  for (const id of [null, undefined, 0, 9, 99, -1, 2.5, Number.NaN]) {
    assert.equal(avatarFor(AVATARS, id), null, String(id));
  }
});

test('the pre-selected avatar is always one of the registry', () => {
  const ids = AVATARS.map((avatar) => avatar.id);
  assert.equal(randomAvatarId(ids, () => 0), 1);
  assert.equal(randomAvatarId(ids, () => 0.999999), 8);
  // Math.random() never returns 1, but a bad generator must not give an id outside the list.
  assert.equal(randomAvatarId(ids, () => 1), 8);
  for (let i = 0; i < 200; i++) assert.ok(ids.includes(randomAvatarId(ids)));
});
