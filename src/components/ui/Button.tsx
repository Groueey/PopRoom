import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
} from 'react-native';

/** Visual style variants supported by `Button`. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Size presets supported by `Button`. */
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Props for the tangerine-themed PopRoom `Button` atom. */
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
}

const CONTAINER_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary border border-primary active:opacity-90',
  secondary: 'bg-primarySoft border border-orange-200 active:bg-orange-100',
  ghost: 'bg-transparent border border-transparent active:bg-zinc-100',
  danger: 'bg-red-500 border border-red-500 active:bg-red-600',
};

const TEXT_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'text-white font-semibold',
  secondary: 'text-primary font-semibold',
  ghost: 'text-ink font-medium',
  danger: 'text-white font-semibold',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 rounded-xl min-h-[36px]',
  md: 'px-4 py-3 rounded-2xl min-h-[46px]',
  lg: 'px-5 py-3.5 rounded-2xl min-h-[52px]',
};

const TEXT_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-base',
};

const SPINNER_COLORS: Record<ButtonVariant, string> = {
  primary: '#FFFFFF',
  secondary: '#F97316',
  ghost: '#18181B',
  danger: '#FFFFFF',
};

/** Warm tangerine-themed pressable button supporting loading states and 4 variants. */
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
  ...pressableProps
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const label = children ?? title;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      className={[
        'flex-row items-center justify-center gap-2',
        SIZE_CLASSES[size],
        CONTAINER_VARIANT_CLASSES[variant],
        fullWidth ? 'w-full' : '',
        isDisabled ? 'opacity-50' : '',
        className,
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
    </Pressable>
  );
}
