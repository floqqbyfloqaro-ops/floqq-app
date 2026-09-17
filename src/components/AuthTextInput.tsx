import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

import { borders, colors, components, elevation, radii, spacing } from '../theme/colors';

type Props = TextInputProps & {
  errorText?: string;
  helperText?: string;
  // 'flat' (default) is today's exact style everywhere else in the app - unaffected by the
  // props below. 'card' is the glass-card treatment with an icon, used by the redesigned
  // Login/New Request screens.
  variant?: 'flat' | 'card';
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  onTrailingIconPress?: () => void;
  trailingIconLabel?: string;
};

export default function AuthTextInput({
  errorText,
  helperText,
  variant = 'flat',
  leadingIcon,
  trailingIcon,
  onTrailingIconPress,
  trailingIconLabel,
  onFocus,
  onBlur,
  style,
  ...props
}: Props) {
  const [isFocused, setIsFocused] = useState(false);
  const hasError = Boolean(errorText);

  const accessibilityLabel =
    props.accessibilityLabel ?? (typeof props.placeholder === 'string' ? props.placeholder : undefined);

  const handleFocus: TextInputProps['onFocus'] = (e) => {
    setIsFocused(true);
    onFocus?.(e);
  };
  const handleBlur: TextInputProps['onBlur'] = (e) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  if (variant === 'card') {
    // The TextInput is the only normal-flow child here (full width, no flex-sibling row) -
    // icons are absolutely positioned over its reserved padding instead of sharing a flex row
    // with it, which is what caused an earlier bug where the input collapsed to near-zero width.
    return (
      <View style={styles.wrapper}>
        <View style={[cardStyles.container, isFocused && cardStyles.focus, hasError && cardStyles.error]}>
          <TextInput
            style={[
              cardStyles.input,
              leadingIcon ? cardStyles.inputWithLeadingIcon : null,
              trailingIcon ? cardStyles.inputWithTrailingIcon : null,
              style,
            ]}
            placeholderTextColor={colors.textSecondary}
            onFocus={handleFocus}
            onBlur={handleBlur}
            accessibilityLabel={accessibilityLabel}
            {...props}
          />
          {leadingIcon ? (
            <View style={cardStyles.leadingIconOverlay} pointerEvents="none">
              <Ionicons name={leadingIcon} size={20} color={colors.textSecondary} />
            </View>
          ) : null}
          {trailingIcon ? (
            <Pressable
              onPress={onTrailingIconPress}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole={onTrailingIconPress ? 'button' : undefined}
              accessibilityLabel={trailingIconLabel}
              style={cardStyles.trailingIconOverlay}
            >
              <Ionicons name={trailingIcon} size={20} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        {hasError ? (
          <Text style={components.input.errorText}>{errorText}</Text>
        ) : helperText ? (
          <Text style={components.input.helper}>{helperText}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <TextInput
        style={[
          components.input.base,
          isFocused && components.input.focus,
          hasError && components.input.error,
          style,
        ]}
        placeholderTextColor={colors.textSecondary}
        onFocus={handleFocus}
        onBlur={handleBlur}
        accessibilityLabel={accessibilityLabel}
        {...props}
      />
      {hasError ? (
        <Text style={components.input.errorText}>{errorText}</Text>
      ) : helperText ? (
        <Text style={components.input.helper}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.x4,
  },
});

const cardStyles = StyleSheet.create({
  container: {
    minHeight: 52,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
    justifyContent: 'center',
    ...elevation.resting,
  },
  focus: {
    borderWidth: 2,
    borderColor: colors.accentPrimary,
  },
  error: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  input: {
    width: '100%',
    minHeight: 52,
    paddingHorizontal: spacing.x4,
    color: colors.textPrimary,
    fontSize: components.input.base.fontSize,
    lineHeight: components.input.base.lineHeight,
  },
  inputWithLeadingIcon: {
    paddingLeft: spacing.x4 + 20 + spacing.x3,
  },
  inputWithTrailingIcon: {
    paddingRight: spacing.x4 + 20 + spacing.x3,
  },
  leadingIconOverlay: {
    position: 'absolute',
    left: spacing.x4,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  trailingIconOverlay: {
    position: 'absolute',
    right: spacing.x4,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
});
