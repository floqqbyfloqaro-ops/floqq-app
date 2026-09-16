import { AccessibilityRole, AccessibilityState, Pressable, View, ViewStyle } from 'react-native';

import { components } from '../theme/colors';

type Props = {
  children: React.ReactNode;
  highlighted?: boolean;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  accessible?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
};

export default function Card({
  children,
  highlighted,
  onPress,
  style,
  accessible,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
}: Props) {
  const cardStyle = [components.glassCard.container, highlighted && components.glassCard.highlighted, style];

  if (onPress) {
    return (
      <Pressable
        style={cardStyle}
        onPress={onPress}
        accessible
        accessibilityRole={accessibilityRole ?? 'button'}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={cardStyle} accessible={accessible} accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
}
