import React from 'react';
import {
  View,
  type PressableProps,
  type ViewProps,
} from 'react-native';
import { CARD_SHADOW } from '../../lib/theme';
import { MotionPressable } from './Motion';

/** Props for the warm elevated white PopRoom `Card` container. */
export interface CardProps extends ViewProps {
  children: React.ReactNode;
  padded?: boolean;
  onPress?: PressableProps['onPress'];
  className?: string;
  elevated?: boolean;
}

/**
 * Clean warm-white porcelain card with soft diffused tangerine-tinted shadow
 * and tactile spring press motion when interactive.
 */
export function Card({
  children,
  padded = true,
  onPress,
  className = '',
  elevated = true,
  style,
  ...viewProps
}: CardProps) {
  const classes = [
    'bg-white rounded-[22px] border border-line',
    padded ? 'p-4' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const cardShadow = elevated ? CARD_SHADOW : undefined;

  if (onPress) {
    return (
      <MotionPressable
        accessibilityRole="button"
        onPress={onPress}
        scaleTo={0.985}
        pressOpacity={0.95}
        style={[cardShadow, style]}
        className={classes}
      >
        {children}
      </MotionPressable>
    );
  }

  return (
    <View className={classes} style={[cardShadow, style]} {...viewProps}>
      {children}
    </View>
  );
}
