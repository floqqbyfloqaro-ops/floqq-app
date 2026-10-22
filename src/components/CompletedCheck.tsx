import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';

import { colors, motion, radii } from '../theme/colors';
import { easingEnter, easingStandard } from '../utils/animation';

const SIZE = 96;

// The "Ride completed" checkmark: a green circle that pops in, with a soft glow that breathes
// behind it. With "Reduce motion" on, it simply appears.
export default function CompletedCheck() {
  const pop = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    let breathing: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotion) => {
        if (cancelled) return;
        if (reduceMotion) {
          pop.setValue(1);
          glow.setValue(0.5);
          return;
        }
        Animated.timing(pop, {
          toValue: 1,
          duration: motion.durationSlow,
          easing: easingEnter,
          useNativeDriver: true,
        }).start();
        breathing = Animated.loop(
          Animated.sequence([
            Animated.timing(glow, { toValue: 1, duration: motion.durationSlow * 4, easing: easingStandard, useNativeDriver: true }),
            Animated.timing(glow, { toValue: 0, duration: motion.durationSlow * 4, easing: easingStandard, useNativeDriver: true }),
          ])
        );
        breathing.start();
      });
    return () => {
      cancelled = true;
      breathing?.stop();
    };
  }, [pop, glow]);

  return (
    <View style={styles.stage} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[
          styles.glow,
          {
            opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] }),
            transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.circle,
          { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] },
        ]}
      >
        <Ionicons name="checkmark" size={56} color={colors.bgPrimary} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: SIZE * 1.6,
    height: SIZE * 1.6,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: SIZE * 1.5,
    height: SIZE * 1.5,
    borderRadius: radii.pill,
    backgroundColor: colors.successSoft,
  },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: radii.pill,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
