// Run with: node --experimental-strip-types --test src/services/passwordRules.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { canSave, confirmError, newPasswordError, passwordStrength } from './passwordRules.ts';

const form = (overrides) => ({ current: 'old-password', next: 'New-pass-2026', confirm: 'New-pass-2026', ...overrides });

test('a valid form can be saved', () => {
  assert.equal(canSave(form({})), true);
});

test('too short, same as the current one, or not matching: no saving', () => {
  assert.equal(newPasswordError(form({ next: 'short7!', confirm: 'short7!' })), 'too_short');
  assert.equal(newPasswordError(form({ next: 'old-password', confirm: 'old-password' })), 'same_as_current');
  assert.equal(confirmError(form({ confirm: 'New-pass-2025' })), 'mismatch');
  assert.equal(canSave(form({ next: 'short7!', confirm: 'short7!' })), false);
  assert.equal(canSave(form({ next: 'old-password', confirm: 'old-password' })), false);
  assert.equal(canSave(form({ confirm: 'New-pass-2025' })), false);
  assert.equal(canSave(form({ current: '' })), false);
});

test('no error before anything is typed', () => {
  assert.equal(newPasswordError(form({ next: '', confirm: '' })), null);
  assert.equal(confirmError(form({ confirm: '' })), null);
});

test('strength: weak under 8 or one kind of character, strong from 12 with 3 kinds', () => {
  assert.equal(passwordStrength(''), null);
  assert.equal(passwordStrength('Ab1!'), 'weak');
  assert.equal(passwordStrength('abcdefghij'), 'weak');
  assert.equal(passwordStrength('abcdefg1'), 'fair');
  assert.equal(passwordStrength('Abcdefghij12'), 'strong');
});

test('"Change password" texts exist in every language', () => {
  for (const language of ['en', 'fr', 'es']) {
    const texts = JSON.parse(readFileSync(new URL(`../i18n/locales/${language}.json`, import.meta.url), 'utf8'));
    for (const key of [
      'title',
      'row',
      'signedInWithApple',
      'signedInWithGoogle',
      'currentPassword',
      'newPassword',
      'confirmPassword',
      'rules',
      'tooShort',
      'sameAsCurrent',
      'mismatch',
      'wrongCurrent',
      'locked',
      'save',
      'forgot',
      'resetSent',
      'success',
    ]) {
      assert.equal(typeof texts.changePassword?.[key], 'string', `${language}: changePassword.${key}`);
    }
  }
});
