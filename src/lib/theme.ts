import { Platform, type ViewStyle } from 'react-native';
import type { BlockType } from '../types/database';

/**
 * PopRoom warm porcelain & terracotta design tokens (Palette A).
 * Mirrors `tailwind.config.js` for inline props (icons, shadows, switches, navigation).
 */
export const THEME_COLORS = {
  primary: '#E05A2B',
  primaryDeep: '#C4481D',
  primarySoft: '#FDF1EC',
  primaryMist: '#FAF8F5',
  primaryBorder: '#F5D5C8',
  primaryTrack: '#F9E2D8',
  surface: '#F6F5F2',
  white: '#FFFFFF',
  ink: '#1F1D1A',
  inkMuted: '#66615B',
  inkSubtle: '#9A938C',
  line: '#EAE6DF',
  lineSoft: '#F2EFEA',
  success: '#2A8565',
  successSoft: '#ECF7F2',
  warning: '#B87314',
  warningSoft: '#FDF6E9',
  danger: '#D14343',
  dangerSoft: '#FEF2F2',
  info: '#3B6FD4',
  infoSoft: '#EEF4FD',
  switchOffTrack: '#E2DDD6',
  switchOffThumb: '#FAF8F5',
} as const;

/** Functional accent token set per collaborative block type. */
export interface BlockAccentPalette {
  accent: string;
  deep: string;
  soft: string;
  border: string;
  track: string;
  barFill: string;
}

/**
 * Harmonious 4-module micro-accents paired with PopRoom's warm porcelain canvas:
 * - poll: warm terracotta
 * - task: sage green
 * - schedule: sky indigo
 * - expense: warm amber
 */
export const BLOCK_ACCENTS: Record<BlockType, BlockAccentPalette> = {
  poll: {
    accent: '#E05A2B',
    deep: '#C4481D',
    soft: '#FDF1EC',
    border: '#F5D5C8',
    track: '#F9E2D8',
    barFill: 'rgba(224, 90, 43, 0.14)',
  },
  task: {
    accent: '#2A8565',
    deep: '#226F53',
    soft: '#ECF7F2',
    border: '#C4E5D6',
    track: '#DCEFE6',
    barFill: 'rgba(42, 133, 101, 0.14)',
  },
  schedule: {
    accent: '#3B6FD4',
    deep: '#2E5CB8',
    soft: '#EEF4FD',
    border: '#C9DCFA',
    track: '#DCE9FC',
    barFill: 'rgba(59, 111, 212, 0.14)',
  },
  expense: {
    accent: '#B87314',
    deep: '#9B5F0F',
    soft: '#FDF6E9',
    border: '#F3DFB8',
    track: '#F7EBD2',
    barFill: 'rgba(184, 115, 20, 0.14)',
  },
};

/** Clean, quiet ambient shadow for elevated white surfaces on the warm stone canvas. */
export const CARD_SHADOW: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#3D342C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  android: {
    elevation: 2,
    shadowColor: '#3D342C',
  },
  default: {
    shadowColor: '#3D342C',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
}) as ViewStyle;

/** Refined terracotta depth shadow for primary CTA buttons. */
export const PRIMARY_BUTTON_SHADOW: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#C4481D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  android: {
    elevation: 3,
    shadowColor: '#C4481D',
  },
  default: {
    shadowColor: '#C4481D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
}) as ViewStyle;

/** Soft floating shadow for toast banners and compact overlays. */
export const FLOATING_SHADOW: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#2B241E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
  },
  android: {
    elevation: 4,
    shadowColor: '#2B241E',
  },
  default: {
    shadowColor: '#2B241E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
  },
}) as ViewStyle;
