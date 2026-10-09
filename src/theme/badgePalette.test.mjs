// Run with: node --experimental-strip-types --test src/theme/badgePalette.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BADGE_COLORS, badgePalette } from './badgePalette.ts';

// The app's status colours (src/theme/colors.ts): a badge must never be mistaken for one of them.
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
// The screen behind the badge.
const BACKGROUND = '#0B0F19';

const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

// WCAG relative luminance and contrast ratio.
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function hue(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueDistance = (a, b) => {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
};

test('there are six badge colours, each with its own shape', () => {
  assert.deepEqual([...BADGE_COLORS].sort(), ['blue', 'orange', 'pink', 'purple', 'teal', 'yellow']);
  assert.equal(new Set(BADGE_COLORS.map((color) => badgePalette[color].shape)).size, 6);
});

test('the number is readable on every badge (WCAG AAA, 7:1)', () => {
  for (const color of BADGE_COLORS) {
    const { fill, number } = badgePalette[color];
    assert.ok(contrast(fill, number) >= 7, `${color}: ${contrast(fill, number).toFixed(2)}:1`);
  }
});

test('every badge stands out from the dark screen behind it', () => {
  for (const color of BADGE_COLORS) {
    const ratio = contrast(badgePalette[color].fill, BACKGROUND);
    assert.ok(ratio >= 4.5, `${color}: ${ratio.toFixed(2)}:1`);
  }
});

test('no badge colour is close to the status green or red', () => {
  for (const color of BADGE_COLORS) {
    const { fill } = badgePalette[color];
    assert.ok(hueDistance(fill, SUCCESS) >= 40, `${color} vs success: ${hueDistance(fill, SUCCESS).toFixed(0)} degrees`);
    assert.ok(hueDistance(fill, DANGER) >= 25, `${color} vs danger: ${hueDistance(fill, DANGER).toFixed(0)} degrees`);
  }
});

test('the badge colours are distinct from each other', () => {
  for (const a of BADGE_COLORS) {
    for (const b of BADGE_COLORS) {
      if (a >= b) continue;
      const distance = hueDistance(badgePalette[a].fill, badgePalette[b].fill);
      assert.ok(distance >= 20, `${a} vs ${b}: ${distance.toFixed(0)} degrees`);
    }
  }
});
