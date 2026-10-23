import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { useReduceMotion } from '../hooks/useReduceMotion';
import { baseText, colors, motion, radii, spacing } from '../theme/colors';
import { easingStandard } from '../utils/animation';

// Three dots while the assistant is thinking, before its first word. With "reduce motion" on they
// stand still. Screen readers hear "The assistant is writing" once.
export default function TypingDots() {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.stagger(
        motion.durationFast,
        dots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, { toValue: 1, duration: motion.durationBase, easing: easingStandard, useNativeDriver: true }),
            Animated.timing(dot, { toValue: 0.3, duration: motion.durationBase, easing: easingStandard, useNativeDriver: true }),
          ])
        )
      )
    );
    loop.start();
    return () => loop.stop();
  }, [dots, reduceMotion]);

  return (
    <View style={styles.row} accessible accessibilityLabel={t('help.typing')} accessibilityLiveRegion="polite">
      {reduceMotion ? (
        <Text style={styles.static}>•••</Text>
      ) : (
        dots.map((dot, index) => <Animated.View key={index} style={[styles.dot, { opacity: dot }]} />)
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x1,
    paddingVertical: spacing.x2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.textSecondary,
  },
  static: {
    ...baseText.body,
    color: colors.textSecondary,
    letterSpacing: 2,
  },
});
