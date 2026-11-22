import React from 'react';
import { Image, Text, View } from 'react-native';

/** Size presets supported by `Avatar`. */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Props for the PopRoom `Avatar` atom. */
export interface AvatarProps {
  nickname?: string | null;
  color?: string | null;
  imageUrl?: string | null;
  size?: AvatarSize;
  className?: string;
}

const SIZE_CONFIG: Record<AvatarSize, { px: number; textClass: string }> = {
  xs: { px: 24, textClass: 'text-xs' },
  sm: { px: 32, textClass: 'text-sm' },
  md: { px: 40, textClass: 'text-base' },
  lg: { px: 52, textClass: 'text-xl' },
  xl: { px: 68, textClass: 'text-2xl' },
};

/** Extracts the first display character from a nickname for initial-circle avatars. */
export function getAvatarInitial(nickname?: string | null): string {
  const trimmed = nickname?.trim();
  if (!trimmed) {
    return '橘';
  }
  const firstChar = Array.from(trimmed)[0];
  return firstChar ? firstChar.toUpperCase() : '橘';
}

/** Renders a circular color-block avatar with the member's initial character (or optional image). */
export function Avatar({
  nickname,
  color,
  imageUrl,
  size = 'md',
  className = '',
}: AvatarProps) {
  const { px, textClass } = SIZE_CONFIG[size];
  const bgColor = color?.trim() || '#F2843A';
  const initial = getAvatarInitial(nickname);

  return (
    <View
      accessibilityLabel={nickname ? `${nickname}的头像` : '用户头像'}
      style={{
        width: px,
        height: px,
        borderRadius: px / 2,
        backgroundColor: bgColor,
      }}
      className={['items-center justify-center overflow-hidden', className]
        .filter(Boolean)
        .join(' ')}
    >
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: px, height: px }}
          resizeMode="cover"
        />
      ) : (
        <Text className={`font-bold text-white ${textClass}`}>{initial}</Text>
      )}
    </View>
  );
}
