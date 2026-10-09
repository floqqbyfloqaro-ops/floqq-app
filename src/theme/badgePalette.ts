// The six group badge colours. A group holds its badge up on the phone so its members recognise
// each other in the arrivals hall, so each colour must read clearly from a few metres away:
//   - never colour alone: every colour has its own shape, and the number is always shown;
//   - `number` is the colour of the number drawn on top, picked for contrast against `fill`;
//   - none of them is the status green or red (colors.success / colors.danger), so a badge is
//     never read as "OK" or as a warning.
// badgePalette.test.mjs checks both the contrast and the distance from the status colours.
//
// No React Native imports, so that test can load this file directly. Re-exported from colors.ts.

export type BadgeColor = 'purple' | 'teal' | 'orange' | 'pink' | 'yellow' | 'blue';
export type BadgeShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon';

export type BadgeStyle = { fill: string; number: string; shape: BadgeShape };

const DARK = '#0B0F19';

export const badgePalette: Record<BadgeColor, BadgeStyle> = {
  purple: { fill: '#A78BFA', number: DARK, shape: 'circle' },
  teal: { fill: '#22D3EE', number: DARK, shape: 'square' },
  orange: { fill: '#FB923C', number: DARK, shape: 'triangle' },
  pink: { fill: '#F472B6', number: DARK, shape: 'diamond' },
  yellow: { fill: '#FDE047', number: DARK, shape: 'star' },
  blue: { fill: '#60A5FA', number: DARK, shape: 'hexagon' },
};

export const BADGE_COLORS = Object.keys(badgePalette) as BadgeColor[];
