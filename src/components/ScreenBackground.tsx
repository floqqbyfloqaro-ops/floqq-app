import { Image, ImageSourcePropType, StyleSheet, View } from 'react-native';

type Props = {
  source: ImageSourcePropType;
  // The source PNGs are unusually tall/narrow (~1:4.7) compared to a phone screen (~1:2.2).
  // resizeMode="cover" centers its crop, which on this aspect ratio hides the artwork's
  // focal point (a glow near the top) entirely. Anchoring the image to the top instead -
  // via absolute position rather than relying on cover's built-in centering - keeps that
  // focal point visible and crops the excess off the bottom instead.
  naturalWidth: number;
  naturalHeight: number;
  scrimColor: string;
  children: React.ReactNode;
};

export default function ScreenBackground({ source, naturalWidth, naturalHeight, scrimColor, children }: Props) {
  return (
    <View style={styles.container}>
      <Image
        source={source}
        resizeMode="cover"
        style={[styles.image, { aspectRatio: naturalWidth / naturalHeight }]}
      />
      <View style={[styles.scrim, { backgroundColor: scrimColor }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
  },
});
