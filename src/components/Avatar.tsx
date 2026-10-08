import { Image, StyleSheet, View, ViewStyle } from 'react-native';

import { borders, colors, elevation, radii } from '../theme/colors';

// Passengers have no photos (there is no avatar concept in the schema), so these are generic
// placeholders - picked by position, not a likeness of anyone.
const PLACEHOLDER_AVATARS = [
  require('../../assets/avatars/avatar-1.png'),
  require('../../assets/avatars/avatar-2.png'),
  require('../../assets/avatars/avatar-3.png'),
];

export const AVATAR_COUNT = PLACEHOLDER_AVATARS.length;

type Props = {
  // Which placeholder to show; wraps around.
  index: number;
  size?: number;
  style?: ViewStyle;
};

export default function Avatar({ index, size = 56, style }: Props) {
  return (
    <View style={[styles.frame, { width: size, height: size }, style]}>
      <Image source={PLACEHOLDER_AVATARS[index % AVATAR_COUNT]} style={styles.image} resizeMode="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceCard,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...elevation.resting,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
