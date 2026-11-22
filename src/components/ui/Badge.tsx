import React from 'react';
import { Text, View } from 'react-native';

/** Semantic color variants supported by `Badge`. */
export type BadgeVariant = 'primary' | 'neutral' | 'success' | 'warning' | 'danger';

/** Size presets supported by `Badge`. */
export type BadgeSize = 'sm' | 'md';

/** Props for the compact PopRoom `Badge` pill. */
export interface BadgeProps {
  label?: string;
  children?: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
  textClassName?: string;
}

const CONTAINER_VARIANT_CLASSES: Record<BadgeVariant, string> = {
  primary: 'bg-primarySoft border border-orange-200',
  neutral: 'bg-zinc-100 border border-zinc-200',
  success: 'bg-emerald-50 border border-emerald-200',
  warning: 'bg-amber-50 border border-amber-200',
  danger: 'bg-red-50 border border-red-200',
};

const TEXT_VARIANT_CLASSES: Record<BadgeVariant, string> = {
  primary: 'text-primary',
  neutral: 'text-zinc-700',
  success: 'text-emerald-700',
  warning: 'text-amber-800',
  danger: 'text-red-700',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5',
  md: 'px-2.5 py-1',
};

const TEXT_SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'text-[11px]',
  md: 'text-xs',
};

/** Compact rounded pill badge for room templates, member roles, and item statuses. */
export function Badge({
  label,
  children,
  variant = 'neutral',
  size = 'sm',
  className = '',
  textClassName = '',
}: BadgeProps) {
  const content = children ?? label;

  return (
    <View
      className={[
        'self-start flex-row items-center rounded-full',
        SIZE_CLASSES[size],
        CONTAINER_VARIANT_CLASSES[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {typeof content === 'string' || typeof content === 'number' ? (
        <Text
          className={[
            'font-semibold',
            TEXT_SIZE_CLASSES[size],
            TEXT_VARIANT_CLASSES[variant],
            textClassName,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {content}
        </Text>
      ) : (
        content
      )}
    </View>
  );
}
