import { Image, StyleSheet, View } from 'react-native';

import { borders, colors, radii } from '../theme/colors';

type Props = {
  size?: number;
};

// The FLOQQ "F" glyph in a round badge: the assistant's face in the help chat.
export default function HelpAvatar({ size = 32 }: Props) {
  return (
    <View
      style={[styles.badge, { width: size, height: size, borderRadius: radii.pill }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={require('../../assets/icon-adaptive-fg.png')} style={{ width: size * 1.4, height: size * 1.4 }} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.accentPrimarySoft,
    borderWidth: borders.regular,
    borderColor: colors.accentPrimaryDeep,
  },
});
