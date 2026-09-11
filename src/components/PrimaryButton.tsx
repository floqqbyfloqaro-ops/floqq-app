import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';

type Props = {
  label: string;
  onPress: () => void;
  loading?: boolean;
};

export default function PrimaryButton({ label, onPress, loading }: Props) {
  return (
    <Pressable style={styles.button} onPress={onPress} disabled={loading}>
      {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
