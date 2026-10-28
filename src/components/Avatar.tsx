import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, View, ViewStyle } from 'react-native';

import { avatarFor } from '../avatars/avatarRules';
import { AVATARS } from '../avatars/registry';
import { borders, colors, overlays, radii } from '../theme/colors';

export type AvatarSize = 'small' | 'medium' | 'large';

const SIZES: Record<AvatarSize, number> = {
  small: 32,
  medium: 44,
  large: 88,
};

type Props = {
  // The passenger's chosen avatar (profiles.avatar_id). Missing or unknown: the neutral default.
  avatarId: number | null | undefined;
  // A named size everywhere; a number only where a layout computes it (the picker's grid).
  size?: AvatarSize | number;
  // What stands in without an avatar: the FLOQQ glyph, or a person's silhouette for someone the
  // app doesn't know yet (the candidates while a match is being searched).
  placeholder?: 'glyph' | 'silhouette';
  // A small dot on the edge, e.g. a member who is sharing their location. A theme colour.
  statusColor?: string;
  style?: ViewStyle;
};

// The one way the app shows a passenger: their avatar, cropped to a circle. Every screen uses
// this; none loads avatar images itself. Decorative for screen readers - the name next to it says
// who it is.
export default function Avatar({ avatarId, size = 'medium', placeholder = 'glyph', statusColor, style }: Props) {
  const side = typeof size === 'number' ? size : SIZES[size];
  const avatar = avatarFor(AVATARS, avatarId);
  const dot = Math.max(8, Math.round(side * 0.26));

  return (
    <View
      style={[{ width: side, height: side }, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.frame, { width: side, height: side }]}>
        {avatar ? (
          <Image source={avatar.source} style={styles.image} resizeMode="cover" fadeDuration={0} />
        ) : placeholder === 'silhouette' ? (
          <Ionicons name="person" size={side * 0.5} color={colors.textDisabled} />
        ) : (
          <Image
            source={require('../../assets/icon-adaptive-fg.png')}
            style={{ width: side * 1.4, height: side * 1.4 }}
            resizeMode="contain"
            fadeDuration={0}
          />
        )}
      </View>
      {statusColor ? (
        <View style={[styles.dot, { width: dot, height: dot, backgroundColor: statusColor }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceCardSolid,
    borderWidth: borders.regular,
    borderColor: overlays.overlayWhite16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  dot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.bgElevated,
  },
});
