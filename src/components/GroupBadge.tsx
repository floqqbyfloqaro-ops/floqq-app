import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated } from 'react-native';
import Svg, { Circle, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { BadgeColor, badgePalette, BadgeShape, fontFamilies, motion } from '../theme/colors';
import { easingStandard } from '../utils/animation';

type Props = {
  color: BadgeColor;
  number: number;
  size?: number;
  // The gentle pulse of the full-screen badge; off for small, static uses.
  pulsing?: boolean;
};

// A five-pointed star with a wide centre, so the number still fits inside it.
const STAR_POINTS = Array.from({ length: 10 }, (_, i) => {
  const radius = i % 2 === 0 ? 49 : 27;
  const angle = (Math.PI / 5) * i - Math.PI / 2;
  return `${(50 + radius * Math.cos(angle)).toFixed(1)},${(52 + radius * Math.sin(angle)).toFixed(1)}`;
}).join(' ');

// Where the number sits in each shape (the visual centre, which for a triangle is low) and how
// large it can be without touching the edges. In a 100 x 100 box.
const NUMBER_PLACEMENT: Record<BadgeShape, { y: number; fontSize: number }> = {
  circle: { y: 50, fontSize: 40 },
  square: { y: 50, fontSize: 42 },
  triangle: { y: 66, fontSize: 28 },
  diamond: { y: 50, fontSize: 32 },
  star: { y: 55, fontSize: 24 },
  hexagon: { y: 50, fontSize: 38 },
};

function Shape({ shape, fill }: { shape: BadgeShape; fill: string }) {
  switch (shape) {
    case 'circle':
      return <Circle cx={50} cy={50} r={48} fill={fill} />;
    case 'square':
      return <Rect x={5} y={5} width={90} height={90} rx={10} fill={fill} />;
    case 'triangle':
      return <Polygon points="50,4 97,92 3,92" fill={fill} />;
    case 'diamond':
      return <Polygon points="50,2 98,50 50,98 2,50" fill={fill} />;
    case 'star':
      return <Polygon points={STAR_POINTS} fill={fill} />;
    case 'hexagon':
      return <Polygon points="50,2 92,26 92,74 50,98 8,74 8,26" fill={fill} />;
  }
}

// A group's badge: its colour, that colour's own shape (so it never depends on colour alone) and
// the group's number. Members hold it up on their phones to recognise each other.
export default function GroupBadge({ color, number, size = 240, pulsing = false }: Props) {
  const { t } = useTranslation();
  const { fill, number: numberColor, shape } = badgePalette[color];
  const { y, fontSize } = NUMBER_PLACEMENT[shape];

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!pulsing) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: motion.durationSlow * 3, easing: easingStandard, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: motion.durationSlow * 3, easing: easingStandard, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, pulsing]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <Animated.View
      style={{ width: size, height: size, transform: [{ scale }] }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('badge.accessibilityLabel', {
        color: t(`badge.color.${color}`),
        shape: t(`badge.shape.${shape}`),
        number,
      })}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Shape shape={shape} fill={fill} />
        <SvgText
          x={50}
          // SVG text sits on its baseline: about a third of the font size below the visual centre.
          y={y + fontSize * 0.35}
          fontSize={fontSize}
          fontWeight="700"
          fontFamily={fontFamilies.sansBold}
          fill={numberColor}
          textAnchor="middle"
        >
          {String(number)}
        </SvgText>
      </Svg>
    </Animated.View>
  );
}
