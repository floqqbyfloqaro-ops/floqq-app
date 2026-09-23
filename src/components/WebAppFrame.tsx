import { Platform, StyleSheet, View } from 'react-native';

import { colors } from '../theme/colors';

// This app has no responsive/web layout of its own - every screen is sized for a phone (fixed
// pixel paddings, full-width buttons meant to span a ~400px screen, etc). Rendered directly in a
// desktop browser window, that same markup stretches edge-to-edge across the whole viewport
// instead of the compact card-based mobile design it was built as, and looks like a different
// app entirely. Constraining it to a centered, phone-width column makes the web build look like
// the native app rather than a broken wide-screen version of it, without touching any native
// code (native's root view already fills the whole physical screen, so this is a no-op there).
const PHONE_WIDTH = 430;

type Props = {
  children: React.ReactNode;
};

export default function WebAppFrame({ children }: Props) {
  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  return (
    <View style={styles.page}>
      <View style={styles.phone}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.bgPrimary,
  },
  phone: {
    flex: 1,
    width: '100%',
    maxWidth: PHONE_WIDTH,
    overflow: 'hidden',
  },
});
