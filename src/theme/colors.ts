import { Platform, StyleSheet, TextStyle, ViewStyle } from 'react-native';

/**
 * FLOQQ Design System
 * Premium dark-mode tokens and component recipes.
 *
 * Usage:
 * - Import named tokens instead of inline values.
 * - Use `gradients.primaryButton` with expo-linear-gradient.
 * - Keep component layouts on the spacing/radius scales below.
 */

export const colors = {
  bgPrimary: '#0B0F19',
  bgElevated: '#0F172A',

  surfaceCard: 'rgba(30, 41, 59, 0.80)',
  surfaceCardSolid: '#1E293B',
  borderSubtle: '#334155',

  accentPrimary: '#7C3AED',
  accentPrimarySoft: 'rgba(124, 58, 237, 0.16)',
  accentPrimaryStrong: '#8B5CF6',
  accentPrimaryDeep: '#5B21B6',

  accentGold: '#F59E0B',
  accentGoldSoft: 'rgba(245, 158, 11, 0.16)',

  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  textDisabled: '#64748B',
  textInverse: '#0B0F19',

  success: '#22C55E',
  successSoft: 'rgba(34, 197, 94, 0.14)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245, 158, 11, 0.14)',
  danger: '#EF4444',
  dangerSoft: 'rgba(239, 68, 68, 0.14)',
  // #EF4444 only clears WCAG AA (4.5:1) as text against the darkest raw background (bgPrimary);
  // against card/elevated surfaces it drops to ~3.8:1. Use dangerStrong for danger TEXT, keep
  // danger for non-text (borders, dots), which only needs the 3:1 UI-component threshold.
  dangerStrong: '#F87171',
  info: '#38BDF8',
  infoSoft: 'rgba(56, 189, 248, 0.14)',

  white: '#FFFFFF',
  transparent: 'transparent',
} as const;

export type ColorToken = keyof typeof colors;
export type ColorValue = (typeof colors)[ColorToken];

export const overlays = {
  scrimLight: 'rgba(11, 15, 25, 0.32)',
  // Strengthened from 0.56/0.78 - the source images have a bright purple/orange glow in the
  // top ~25%, and worst-case contrast math against that brightness showed the old values
  // couldn't reliably guarantee AA for text landing near it.
  scrimMedium: 'rgba(11, 15, 25, 0.74)',
  scrimHeavy: 'rgba(11, 15, 25, 0.88)',
  overlayWhite08: 'rgba(248, 250, 252, 0.08)',
  overlayWhite12: 'rgba(248, 250, 252, 0.12)',
  overlayWhite16: 'rgba(248, 250, 252, 0.16)',
  overlayPurple08: 'rgba(124, 58, 237, 0.08)',
  overlayPurple16: 'rgba(124, 58, 237, 0.16)',
  overlayPurple24: 'rgba(124, 58, 237, 0.24)',
} as const;

export const gradients = {
  primaryButton: ['#7C3AED', '#6D28D9'] as const,
  primaryButtonPressed: ['#6D28D9', '#5B21B6'] as const,
  primaryGlow: ['rgba(124, 58, 237, 0.34)', 'rgba(124, 58, 237, 0.00)'] as const,
  goldGlow: ['rgba(245, 158, 11, 0.24)', 'rgba(245, 158, 11, 0.00)'] as const,
} as const;

export const typography = {
  display: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  h1: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  h3: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: 0,
  },
  bodySmall: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: 0,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    letterSpacing: 0.1,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
} as const;

export type TypographyToken = keyof typeof typography;
export type TypographyStyle = (typeof typography)[TypographyToken];

export const fontFamilies = {
  sans: Platform.select({
    ios: 'Inter',
    android: 'Inter',
    default: 'System',
  }) as string,
  sansMedium: Platform.select({
    ios: 'Inter-Medium',
    android: 'Inter-Medium',
    default: 'System',
  }) as string,
  sansSemibold: Platform.select({
    ios: 'Inter-SemiBold',
    android: 'Inter-SemiBold',
    default: 'System',
  }) as string,
  sansBold: Platform.select({
    ios: 'Inter-Bold',
    android: 'Inter-Bold',
    default: 'System',
  }) as string,
} as const;

export const spacing = {
  x1: 4,
  x2: 8,
  x3: 12,
  x4: 16,
  x6: 24,
  x8: 32,
  x12: 48,
} as const;

export type SpacingToken = keyof typeof spacing;
export type SpacingValue = (typeof spacing)[SpacingToken];

export const radii = {
  sm: 8,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radii;
export type RadiusValue = (typeof radii)[RadiusToken];

export const borders = {
  hairline: StyleSheet.hairlineWidth,
  regular: 1,
} as const;

export const elevation = {
  resting: {
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  } satisfies ViewStyle,

  raised: {
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 6,
  } satisfies ViewStyle,

  floating: {
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 12,
  } satisfies ViewStyle,
} as const;

export const motion = {
  durationFast: 120,
  durationBase: 200,
  durationSlow: 320,
  easingStandard: 'cubic-bezier(0.2, 0.0, 0.0, 1.0)',
  easingEnter: 'cubic-bezier(0.16, 1.0, 0.3, 1.0)',
  easingExit: 'cubic-bezier(0.7, 0.0, 0.84, 0.0)',
} as const;

export type ButtonState = 'default' | 'pressed' | 'disabled' | 'focus';
export type InputState = 'default' | 'focus' | 'error';
export type StatusName = 'Searching' | 'Group Confirmed' | 'Driver En Route' | 'Cancelled';

export const components = {
  glassCard: {
    container: {
      backgroundColor: colors.surfaceCard,
      borderWidth: borders.regular,
      borderColor: overlays.overlayWhite08,
      borderRadius: radii.lg,
      padding: spacing.x4,
      ...elevation.resting,
    } satisfies ViewStyle,
    highlighted: {
      borderColor: overlays.overlayPurple24,
      ...elevation.raised,
    } satisfies ViewStyle,
  },

  primaryButton: {
    base: {
      minHeight: 52,
      paddingHorizontal: spacing.x6,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: spacing.x2,
    } satisfies ViewStyle,
    default: {
      ...elevation.raised,
    } satisfies ViewStyle,
    pressed: {
      transform: [{ scale: 0.985 }],
      ...elevation.resting,
    } satisfies ViewStyle,
    disabled: {
      opacity: 0.44,
      shadowOpacity: 0,
      elevation: 0,
    } satisfies ViewStyle,
    focus: {
      borderWidth: 2,
      borderColor: colors.accentPrimaryStrong,
      ...elevation.raised,
    } satisfies ViewStyle,
    label: {
      ...typography.label,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '700',
      color: colors.white,
    } satisfies TextStyle,
  },

  secondaryButton: {
    base: {
      minHeight: 52,
      paddingHorizontal: spacing.x6,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: spacing.x2,
      borderWidth: borders.regular,
      borderColor: colors.borderSubtle,
      backgroundColor: overlays.overlayWhite08,
    } satisfies ViewStyle,
    default: {
      ...elevation.resting,
    } satisfies ViewStyle,
    pressed: {
      backgroundColor: overlays.overlayWhite12,
      borderColor: colors.textSecondary,
      transform: [{ scale: 0.985 }],
    } satisfies ViewStyle,
    disabled: {
      opacity: 0.42,
    } satisfies ViewStyle,
    focus: {
      borderWidth: 2,
      borderColor: colors.accentPrimaryStrong,
      backgroundColor: overlays.overlayPurple08,
    } satisfies ViewStyle,
    label: {
      ...typography.label,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '700',
      color: colors.textPrimary,
    } satisfies TextStyle,
  },

  input: {
    base: {
      minHeight: 52,
      paddingHorizontal: spacing.x4,
      borderRadius: radii.md,
      borderWidth: borders.regular,
      borderColor: colors.borderSubtle,
      backgroundColor: colors.bgElevated,
      color: colors.textPrimary,
      ...typography.body,
    } satisfies TextStyle & ViewStyle,
    default: {
      borderColor: colors.borderSubtle,
    } satisfies ViewStyle,
    focus: {
      borderWidth: 2,
      borderColor: colors.accentPrimary,
      backgroundColor: overlays.overlayPurple08,
      ...elevation.resting,
    } satisfies ViewStyle,
    error: {
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    } satisfies ViewStyle,
    placeholder: {
      color: colors.textDisabled,
    } satisfies TextStyle,
    helper: {
      marginTop: spacing.x2,
      ...typography.caption,
      color: colors.textSecondary,
    } satisfies TextStyle,
    errorText: {
      marginTop: spacing.x2,
      ...typography.caption,
      color: colors.dangerStrong,
    } satisfies TextStyle,
  },

  statusPill: {
    base: {
      minHeight: 28,
      paddingHorizontal: spacing.x3,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: spacing.x2,
      alignSelf: 'flex-start',
    } satisfies ViewStyle,
    label: {
      ...typography.label,
      fontSize: 11,
      lineHeight: 16,
    } satisfies TextStyle,
  },
} as const;

export const statusStyles: Record<StatusName, { container: ViewStyle; label: TextStyle; dot: ViewStyle }> = {
  Searching: {
    container: {
      backgroundColor: colors.infoSoft,
      borderWidth: borders.regular,
      borderColor: 'rgba(56, 189, 248, 0.28)',
    },
    label: { color: colors.info },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 999,
      backgroundColor: colors.info,
    },
  },
  'Group Confirmed': {
    container: {
      backgroundColor: colors.successSoft,
      borderWidth: borders.regular,
      borderColor: 'rgba(34, 197, 94, 0.28)',
    },
    label: { color: colors.success },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 999,
      backgroundColor: colors.success,
    },
  },
  'Driver En Route': {
    container: {
      backgroundColor: colors.warningSoft,
      borderWidth: borders.regular,
      borderColor: 'rgba(245, 158, 11, 0.30)',
    },
    label: { color: colors.warning },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 999,
      backgroundColor: colors.warning,
    },
  },
  Cancelled: {
    container: {
      backgroundColor: colors.dangerSoft,
      borderWidth: borders.regular,
      borderColor: 'rgba(239, 68, 68, 0.28)',
    },
    label: { color: colors.dangerStrong },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 999,
      backgroundColor: colors.danger,
    },
  },
};

export const baseText = StyleSheet.create({
  display: {
    ...typography.display,
    color: colors.textPrimary,
    fontFamily: fontFamilies.sansBold,
  },
  h1: {
    ...typography.h1,
    color: colors.textPrimary,
    fontFamily: fontFamilies.sansBold,
  },
  h2: {
    ...typography.h2,
    color: colors.textPrimary,
    fontFamily: fontFamilies.sansBold,
  },
  h3: {
    ...typography.h3,
    color: colors.textPrimary,
    fontFamily: fontFamilies.sansSemibold,
  },
  body: {
    ...typography.body,
    color: colors.textPrimary,
    fontFamily: fontFamilies.sans,
  },
  bodySmall: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    fontFamily: fontFamilies.sans,
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: fontFamilies.sans,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    fontFamily: fontFamilies.sansSemibold,
  },
});

export const screens = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    paddingHorizontal: spacing.x4,
    paddingVertical: spacing.x6,
  },
  section: {
    marginBottom: spacing.x8,
  },
});
