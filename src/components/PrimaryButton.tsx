import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text } from 'react-native';

import { colors, components, elevation, gradients, motion } from '../theme/colors';
import { easingStandard } from '../utils/animation';

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

export default function PrimaryButton({ label, onPress, loading, disabled }: Props) {
  const isDisabled = disabled || loading;
  const [isPressed, setIsPressed] = useState(false);
  const press = useRef(new Animated.Value(0)).current;

  const animateTo = (toValue: number) => {
    Animated.timing(press, {
      toValue,
      duration: motion.durationFast,
      easing: easingStandard,
      useNativeDriver: false,
    }).start();
  };

  const animatedStyle = {
    transform: [{ scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] }) }],
    shadowOpacity: press.interpolate({ inputRange: [0, 1], outputRange: [elevation.raised.shadowOpacity, 0.4] }),
    shadowRadius: press.interpolate({ inputRange: [0, 1], outputRange: [elevation.raised.shadowRadius, 22] }),
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        setIsPressed(true);
        animateTo(1);
      }}
      onPressOut={() => {
        setIsPressed(false);
        animateTo(0);
      }}
      disabled={isDisabled}
      style={styles.wrapper}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
    >
      <AnimatedGradient
        colors={isPressed ? gradients.primaryButtonPressed : gradients.primaryButton}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          components.primaryButton.base,
          elevation.raised,
          animatedStyle,
          isDisabled && components.primaryButton.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={components.primaryButton.label}>{label}</Text>
        )}
      </AnimatedGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 20,
  },
});
