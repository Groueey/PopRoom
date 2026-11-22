import { Platform, type ViewStyle } from 'react-native';

/**
 * PopRoom gentle white & warm tangerine design tokens.
 * Mirrors `tailwind.config.js` for inline props (icons, shadows, switches, navigation).
 */
export const THEME_COLORS = {
  primary: '#F2843A',
  primaryDeep: '#D96820',
  primarySoft: '#FFF6EE',
  primaryMist: '#FFFBF7',
  primaryBorder: '#FCDCC3',
  primaryTrack: '#FDE4CE',
  surface: '#FAF7F4',
  white: '#FFFFFF',
  ink: '#26201B',
  inkMuted: '#73685F',
  inkSubtle: '#A3988F',
  line: '#EFE8E1',
  lineSoft: '#F6F1EC',
  success: '#2E8B67',
  successSoft: '#EEF8F3',
  warning: '#B86E18',
  warningSoft: '#FEF7E8',
  danger: '#D14B4B',
  dangerSoft: '#FEF2F2',
  switchOffTrack: '#E6DFD8',
  switchOffThumb: '#FAF7F4',
} as const;

/** Warm, airy ambient shadow for elevated white cards on the milky canvas. */
export const CARD_SHADOW: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#C87D4B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
  },
  android: {
    elevation: 2,
    shadowColor: '#C87D4B',
  },
  default: {
    shadowColor: '#C87D4B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
  },
}) as ViewStyle;

/** Soft warm orange glow for primary CTA buttons. */
export const PRIMARY_BUTTON_SHADOW: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#E8762C',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
  },
  android: {
    elevation: 3,
    shadowColor: '#E8762C',
  },
  default: {
    shadowColor: '#E8762C',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
  },
}) as ViewStyle;

/** Soft floating shadow for toast banners and sticky bars. */
export const FLOATING_SHADOW: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#7C4A26',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
  },
  android: {
    elevation: 5,
    shadowColor: '#7C4A26',
  },
  default: {
    shadowColor: '#7C4A26',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
  },
}) as ViewStyle;
