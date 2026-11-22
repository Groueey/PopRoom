import React from 'react';
import {
  ActivityIndicator,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { PRIMARY_BUTTON_SHADOW, THEME_COLORS } from '../../lib/theme';
import { MotionPressable } from './Motion';

/** Visual style variants supported by `Button`. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Size presets supported by `Button`. */
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Props for the warm tangerine-themed PopRoom `Button` atom. */
export interface ButtonProps extends Omit<PressableProps, 'children'> {
  title?: string;
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  className?: string;
  textClassName?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

const CONTAINER_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary border border-primary',
  secondary: 'bg-primarySoft border border-primaryBorder',
  ghost: 'bg-transparent border border-transparent',
  danger: 'bg-[#DF5A52] border border-[#DF5A52]',
};

const TEXT_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'text-white font-semibold',
  secondary: 'text-primaryDeep font-semibold',
  ghost: 'text-ink font-medium',
  danger: 'text-white font-semibold',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3.5 py-2 rounded-xl min-h-[38px]',
  md: 'px-4 py-3 rounded-2xl min-h-[46px]',
  lg: 'px-5 py-3.5 rounded-2xl min-h-[52px]',
};

const TEXT_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'text-sm',
  md: 'text-[15px]',
  lg: 'text-base',
};

const SPINNER_COLORS: Record<ButtonVariant, string> = {
  primary: '#FFFFFF',
  secondary: THEME_COLORS.primaryDeep,
  ghost: THEME_COLORS.ink,
  danger: '#FFFFFF',
};

/** Gentle warm-tangerine button with tactile spring press feedback and 4 variants. */
export function Button({
  title,
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  leftIcon,
  className = '',
  textClassName = '',
  containerStyle,
  style,
  ...pressableProps
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const label = children ?? title;
  const hasFlexOne = /(?:^|\s)flex-1(?:\s|$)/.test(className);
  const cleanedClassName = hasFlexOne
    ? className.replace(/(?:^|\s)flex-1(?=\s|$)/g, ' ').trim()
    : className;

  const primaryShadowStyle =
    variant === 'primary' && !isDisabled ? PRIMARY_BUTTON_SHADOW : undefined;

  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      scaleTo={0.97}
      pressOpacity={0.93}
      fullWidth={fullWidth}
      flex={hasFlexOne}
      containerStyle={containerStyle}
      style={
        typeof style === 'function'
          ? (state) => [primaryShadowStyle, style(state)]
          : [primaryShadowStyle, style]
      }
      className={[
        'flex-row items-center justify-center gap-2',
        SIZE_CLASSES[size],
        CONTAINER_VARIANT_CLASSES[variant],
        fullWidth ? 'w-full' : '',
        isDisabled ? 'opacity-50' : '',
        cleanedClassName,
      ]
        .filter(Boolean)
        .join(' ')}
      {...pressableProps}
    >
      {loading ? (
        <ActivityIndicator size="small" color={SPINNER_COLORS[variant]} />
      ) : (
        leftIcon ?? null
      )}
      {typeof label === 'string' || typeof label === 'number' ? (
        <Text
          className={[
            'text-center',
            TEXT_SIZE_CLASSES[size],
            TEXT_VARIANT_CLASSES[variant],
            textClassName,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {label}
        </Text>
      ) : (
        label
      )}
    </MotionPressable>
  );
}
