import { ReactNode, useEffect, useRef } from 'react';
import { Animated, StyleSheet, useWindowDimensions } from 'react-native';

import { useReduceMotion } from '../hooks/useReduceMotion';
import { colors, motion } from '../theme/colors';
import { easingEnter } from '../utils/animation';

type Props = {
  children: ReactNode;
};

// A screen that comes in from the right, like a native push (just over 200 ms, the motion
// tokens). With "reduce motion" it is simply there.
export default function SlideInScreen({ children }: Props) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const offset = useRef(new Animated.Value(width)).current;

  useEffect(() => {
    if (reduceMotion) {
      offset.setValue(0);
      return;
    }
    Animated.timing(offset, {
      toValue: 0,
      duration: motion.durationBase + motion.durationFast / 6,
      easing: easingEnter,
      useNativeDriver: true,
    }).start();
  }, [offset, reduceMotion]);

  return <Animated.View style={[styles.screen, { transform: [{ translateX: offset }] }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
});
