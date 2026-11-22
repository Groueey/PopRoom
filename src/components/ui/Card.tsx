import React from 'react';
import {
  Pressable,
  View,
  type PressableProps,
  type ViewProps,
} from 'react-native';

/** Props for the rounded white PopRoom `Card` container. */
export interface CardProps extends ViewProps {
  children: React.ReactNode;
  padded?: boolean;
  onPress?: PressableProps['onPress'];
  className?: string;
}

/** Clean white rounded card with thin slate border matching PopRoom's light card aesthetic. */
export function Card({
  children,
  padded = true,
  onPress,
  className = '',
  ...viewProps
}: CardProps) {
  const classes = [
    'bg-white rounded-2xl border border-zinc-200/80',
    padded ? 'p-4' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        className={`${classes} active:opacity-90`}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View className={classes} {...viewProps}>
      {children}
    </View>
  );
}
