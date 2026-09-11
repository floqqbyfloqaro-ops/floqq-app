import { StyleSheet, TextInput, TextInputProps } from 'react-native';

import { colors } from '../theme/colors';

export default function AuthTextInput(props: TextInputProps) {
  return <TextInput style={styles.input} placeholderTextColor={colors.textSecondary} {...props} />;
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    marginBottom: 16,
    fontSize: 16,
  },
});
