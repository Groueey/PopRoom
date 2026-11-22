import { RefreshCw, WifiOff } from 'lucide-react-native';
import React from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { THEME_COLORS } from '../../lib/theme';
import { MotionPressable } from './Motion';

/** Props for the subtle inline offline/sync-failed notice banner. */
export interface OfflineSyncBannerProps {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Subtle warm-honey inline banner rendered above cached content when background refetch fails. */
export function OfflineSyncBanner({
  message,
  onRetry,
  retrying = false,
}: OfflineSyncBannerProps) {
  return (
    <Animated.View entering={FadeInUp.duration(220)} exiting={FadeOutUp.duration(180)}>
      <View
        accessibilityRole="alert"
        className="mb-3 flex-row items-center gap-2.5 rounded-2xl border border-[#F5DFB3] bg-[#FEF7E8] px-3.5 py-2.5"
      >
        <WifiOff size={16} color={THEME_COLORS.warning} />
        <Text className="flex-1 text-xs leading-4 text-[#8C5210]">{message}</Text>
        {onRetry ? (
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel="重试同步"
            disabled={retrying}
            onPress={onRetry}
            scaleTo={0.94}
            className="flex-row items-center gap-1 rounded-xl border border-[#F2CF8D] bg-white px-2.5 py-1"
          >
            <RefreshCw size={12} color={THEME_COLORS.warning} />
            <Text className="text-[11px] font-semibold text-[#8C5210]">
              {retrying ? '同步中' : '重试'}
            </Text>
          </MotionPressable>
        ) : null}
      </View>
    </Animated.View>
  );
}
