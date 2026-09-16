import { useEffect, useRef } from 'react';
import { Animated, DimensionValue } from 'react-native';

import { colors, motion, radii } from '../theme/colors';
import { easingStandard } from '../utils/animation';

type Props = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: object;
};

export default function Skeleton({ width = '100%', height = 16, radius = radii.sm, style }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: motion.durationBase, easing: easingStandard, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: motion.durationBase, easing: easingStandard, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceCardSolid, opacity }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
