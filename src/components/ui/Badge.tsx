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
  primary: 'bg-primarySoft border border-primaryBorder',
  neutral: 'bg-surface border border-line',
  success: 'bg-[#EEF8F3] border border-[#CBEAD9]',
  warning: 'bg-[#FEF7E8] border border-[#F5DFB3]',
  danger: 'bg-[#FEF2F2] border border-[#FAD2D0]',
};

const TEXT_VARIANT_CLASSES: Record<BadgeVariant, string> = {
  primary: 'text-primaryDeep',
  neutral: 'text-inkMuted',
  success: 'text-[#287B5B]',
  warning: 'text-[#A66214]',
  danger: 'text-[#C94545]',
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
