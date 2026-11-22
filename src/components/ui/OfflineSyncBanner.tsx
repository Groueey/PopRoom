import { RefreshCw, WifiOff } from 'lucide-react-native';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

/** Props for the subtle inline offline/sync-failed notice banner. */
export interface OfflineSyncBannerProps {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Subtle inline banner rendered above cached room content when background refetch fails. */
export function OfflineSyncBanner({
  message,
  onRetry,
  retrying = false,
}: OfflineSyncBannerProps) {
  return (
    <View
      accessibilityRole="alert"
      className="mb-3 flex-row items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/95 px-3.5 py-2.5"
    >
      <WifiOff size={16} color="#B45309" />
      <Text className="flex-1 text-xs leading-4 text-amber-900">{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重试同步"
          disabled={retrying}
          onPress={onRetry}
          className="flex-row items-center gap-1 rounded-xl border border-amber-300 bg-white px-2.5 py-1 active:bg-amber-100"
        >
          <RefreshCw size={12} color="#B45309" />
          <Text className="text-[11px] font-semibold text-amber-900">
            {retrying ? '同步中' : '重试'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
