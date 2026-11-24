import React from 'react';
import { Text, View } from 'react-native';

/** Semantic color variants supported by `Badge`. */
export type BadgeVariant = 'primary' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

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
  primary: 'bg-primarySoft border border-primaryBorder',
  neutral: 'bg-surface border border-line',
  success: 'bg-[#ECF7F2] border border-[#C4E5D6]',
  warning: 'bg-[#FDF6E9] border border-[#F3DFB8]',
  danger: 'bg-[#FEF2F2] border border-[#F8CFCF]',
  info: 'bg-[#EEF4FD] border border-[#C9DCFA]',
};

const TEXT_VARIANT_CLASSES: Record<BadgeVariant, string> = {
  primary: 'text-primaryDeep',
  neutral: 'text-inkMuted',
  success: 'text-[#226F53]',
  warning: 'text-[#9B5F0F]',
  danger: 'text-[#C23B3B]',
  info: 'text-[#2E5CB8]',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'px-2.5 py-0.5',
  md: 'px-3 py-1',
};

const TEXT_SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'text-[11px]',
  md: 'text-xs',
};

/** Gentle warm pill badge for room templates, member roles, and item statuses. */
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
