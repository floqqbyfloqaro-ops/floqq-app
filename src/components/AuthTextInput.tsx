import { useState } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

import { colors, components } from '../theme/colors';

type Props = TextInputProps & {
  errorText?: string;
  helperText?: string;
};

export default function AuthTextInput({ errorText, helperText, onFocus, onBlur, style, ...props }: Props) {
  const [isFocused, setIsFocused] = useState(false);
  const hasError = Boolean(errorText);

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
        onFocus={(e) => {
          setIsFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          onBlur?.(e);
        }}
        accessibilityLabel={props.accessibilityLabel ?? (typeof props.placeholder === 'string' ? props.placeholder : undefined)}
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
    marginBottom: 16,
  },
});
