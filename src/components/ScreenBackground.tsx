import { useState } from 'react';
import { Dimensions, Image, ImageSourcePropType, LayoutChangeEvent, StyleSheet, View } from 'react-native';

type Props = {
  source: ImageSourcePropType;
  // True "cover" scaling (matches whichever dimension - width or height - needs more scale to
  // fill the screen) computed from the source's real pixel size, then anchored to the TOP rather
  // than centered. Some source images concentrate their focal point near the top; a standard
  // centered crop can hide it entirely on images that are tall/narrow relative to the screen.
  // Images wide/short relative to the screen get no vertical crop at all under this scaling, so
  // top-anchoring is a no-op for them - this one computation handles both cases correctly.
  naturalWidth: number;
  naturalHeight: number;
  scrimColor: string;
  children: React.ReactNode;
  // Which edge stays flush with the screen once the image is scaled to cover - 'top' (default)
  // keeps today's behavior for every other screen. 'bottom' crops excess off the top instead,
  // useful when a photo's focal point sits lower in the frame.
  verticalAlign?: 'top' | 'bottom';
  // Extra scale beyond the minimum needed to cover the screen, so there's crop room for
  // verticalAlign to actually trim something. 1 (default) = the old exact behavior.
  zoom?: number;
};

export default function ScreenBackground({
  source,
  naturalWidth,
  naturalHeight,
  scrimColor,
  children,
  verticalAlign = 'top',
  zoom = 1,
}: Props) {
  // Measures its own rendered box rather than the window: on native the two are always the same
  // (this sits directly under the full-screen root), but on web the window can be an arbitrary
  // desktop-sized browser viewport while this component itself is constrained to a phone-width
  // column by WebAppFrame - using the window here would compute the cover-scale against the
  // wrong (much wider/shorter) box and leave the image mis-scaled or barely visible.
  const initial = Dimensions.get('window');
  const [size, setSize] = useState({ width: initial.width, height: initial.height });

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== size.width || height !== size.height) {
      setSize({ width, height });
    }
  };

  const scale = Math.max(size.width / naturalWidth, size.height / naturalHeight) * zoom;
  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;
  const top = verticalAlign === 'bottom' ? size.height - renderedHeight : 0;

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <Image
        source={source}
        resizeMode="cover"
        style={{
          position: 'absolute',
          top,
          left: (size.width - renderedWidth) / 2,
          width: renderedWidth,
          height: renderedHeight,
        }}
      />
      <View style={[styles.scrim, { backgroundColor: scrimColor }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  scrim: {
    ...StyleSheet.absoluteFill,
  },
});
