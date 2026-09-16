import { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';

import { components, motion, StatusName, statusStyles } from '../theme/colors';
import { easingStandard } from '../utils/animation';

type Props = {
  status: StatusName;
  label?: string;
};

export default function StatusPill({ status, label }: Props) {
  const style = statusStyles[status];
  const key = `${status}:${label ?? ''}`;
  const prevKey = useRef<string | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (prevKey.current !== key) {
      prevKey.current = key;
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: motion.durationBase,
        easing: easingStandard,
        useNativeDriver: true,
      }).start();
    }
  }, [key, progress]);

  const animatedStyle = {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
  };

  const displayLabel = label ?? status;

  return (
    <Animated.View
      style={[components.statusPill.base, style.container, animatedStyle]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={displayLabel}
    >
      <View style={style.dot} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />
      <Text style={[components.statusPill.label, style.label]}>{displayLabel}</Text>
    </Animated.View>
  );
}
