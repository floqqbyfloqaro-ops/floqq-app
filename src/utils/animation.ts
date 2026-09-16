import { Easing } from 'react-native';

import { motion } from '../theme/colors';

function parseCubicBezier(token: string): [number, number, number, number] {
  const match = token.match(/cubic-bezier\(([^)]+)\)/);
  const [x1, y1, x2, y2] = (match?.[1] ?? '0.2,0,0,1').split(',').map(Number);
  return [x1, y1, x2, y2];
}

export const easingStandard = Easing.bezier(...parseCubicBezier(motion.easingStandard));
export const easingEnter = Easing.bezier(...parseCubicBezier(motion.easingEnter));
export const easingExit = Easing.bezier(...parseCubicBezier(motion.easingExit));
