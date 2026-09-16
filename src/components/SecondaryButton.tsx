import { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, Text } from 'react-native';

import { colors, components, elevation, motion, overlays } from '../theme/colors';
import { easingStandard } from '../utils/animation';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

export default function SecondaryButton({ label, onPress, loading, disabled }: Props) {
  const isDisabled = disabled || loading;
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
    backgroundColor: press.interpolate({
      inputRange: [0, 1],
      outputRange: [overlays.overlayWhite08, overlays.overlayWhite12],
    }),
    borderColor: press.interpolate({
      inputRange: [0, 1],
      outputRange: [colors.borderSubtle, colors.textSecondary],
    }),
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => animateTo(1)}
      onPressOut={() => animateTo(0)}
      disabled={isDisabled}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
    >
      <Animated.View
        style={[
          components.secondaryButton.base,
          elevation.resting,
          animatedStyle,
          isDisabled && components.secondaryButton.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={colors.textPrimary} />
        ) : (
          <Text style={components.secondaryButton.label}>{label}</Text>
        )}
      </Animated.View>
    </Pressable>
  );
}
