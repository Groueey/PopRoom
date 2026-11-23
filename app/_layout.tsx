import '../global.css';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import type { Session } from '@supabase/supabase-js';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import {
  Stack,
  useRootNavigationState,
  useRouter,
  useSegments,
  type Href,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react-native';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  type MyRoomsResult,
  fetchMyRooms,
  findJoinedRoomByCode,
} from '../src/api/rooms';
import { MotionPressable } from '../src/components/ui/Motion';
import {
  QUERY_KEYS,
  asyncStoragePersister,
  queryClient,
} from '../src/lib/queryClient';
import { clearCachedProfile, profileCache } from '../src/lib/profileCache';
import {
  extractRoomCodeFromText,
  extractRoomCodeFromUrl,
} from '../src/lib/roomCode';
import { fetchProfileByUserId, supabase } from '../src/lib/supabase';
import { FLOATING_SHADOW, THEME_COLORS } from '../src/lib/theme';
import {
  computeNavigationStep,
  loadProfileWithFallback,
  registerProfileCache,
  registerProfileFetcher,
  useAuthStore,
} from '../src/stores/authStore';
import { type ToastVariant, useUiStore } from '../src/stores/uiStore';

registerProfileFetcher(fetchProfileByUserId);
registerProfileCache(profileCache);

const TOAST_STYLE_MAP: Record<
  ToastVariant,
  { container: string; iconBg: string; iconColor: string }
> = {
  info: {
    container: 'bg-white border border-primaryBorder',
    iconBg: 'bg-primarySoft',
    iconColor: THEME_COLORS.primaryDeep,
  },
  success: {
    container: 'bg-white border border-[#CBEAD9]',
    iconBg: 'bg-[#EEF8F3]',
    iconColor: THEME_COLORS.success,
  },
  error: {
    container: 'bg-white border border-[#FAD2D0]',
    iconBg: 'bg-[#FEF2F2]',
    iconColor: THEME_COLORS.danger,
  },
};

function ToastIcon({ type }: { type: ToastVariant }) {
  const color = TOAST_STYLE_MAP[type].iconColor;
  if (type === 'success') {
    return <CheckCircle2 size={16} color={color} />;
  }
  if (type === 'error') {
    return <AlertCircle size={16} color={color} />;
  }
  return <Info size={16} color={color} />;
}

/** Global top toast banner overlay reading from `useUiStore` with spring slide animation. */
function ToastOverlay() {
  const insets = useSafeAreaInsets();
  const toast = useUiStore((s) => s.toast);
  const dismissToast = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = setTimeout(() => {
      dismissToast(toast.id);
    }, toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) {
    return null;
  }

  const variantStyle = TOAST_STYLE_MAP[toast.type];

  return (
    <Animated.View
      key={toast.id}
      entering={FadeInUp.duration(260).springify().damping(18).stiffness(260)}
      exiting={FadeOutUp.duration(180)}
      pointerEvents="box-none"
      style={{ top: insets.top + 8 }}
      className="absolute left-4 right-4 z-50"
    >
      <MotionPressable
        accessibilityRole="alert"
        scaleTo={0.98}
        onPress={() => dismissToast(toast.id)}
        style={FLOATING_SHADOW}
        className={`flex-row items-center gap-2.5 rounded-2xl px-3.5 py-3 ${variantStyle.container}`}
      >
        <View
          className={`h-7 w-7 items-center justify-center rounded-full ${variantStyle.iconBg}`}
        >
          <ToastIcon type={toast.type} />
        </View>
        <Text className="flex-1 text-sm font-semibold text-ink">
          {toast.message}
        </Text>
        <X size={15} color={THEME_COLORS.inkSubtle} />
      </MotionPressable>
    </Animated.View>
  );
}

/** Coordinates auth bootstrap, deep-link capture, route guarding, and global overlays. */
function RootNavigator() {
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();

  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const initialized = useAuthStore((s) => s.initialized);
  const pendingRoomCode = useAuthStore((s) => s.pendingRoomCode);
  const setAuthSnapshot = useAuthStore((s) => s.setAuthSnapshot);
  const setInitialized = useAuthStore((s) => s.setInitialized);
  const setPendingRoomCode = useAuthStore((s) => s.setPendingRoomCode);
  const clearPendingRoomCode = useAuthStore((s) => s.clearPendingRoomCode);
  const showToast = useUiStore((s) => s.showToast);
  const inFlightJoinTargetRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let initialHandled = false;
    let latestSyncId = 0;

    const syncSession = async (nextSession: Session | null) => {
      const syncId = ++latestSyncId;

      if (!nextSession?.user?.id) {
        if (isMounted && syncId === latestSyncId) {
          setAuthSnapshot({ session: null, profile: null, initialized: true });
        }
        return;
      }

      const current = useAuthStore.getState();
      const inMemoryProfile =
        current.session?.user.id === nextSession.user.id
          ? current.profile
          : null;

      const result = await loadProfileWithFallback(nextSession.user.id, {
        inMemoryProfile,
        fetcher: fetchProfileByUserId,
        cache: profileCache,
      });

      if (!isMounted || syncId !== latestSyncId) {
        return;
      }

      setAuthSnapshot({
        session: nextSession,
        profile: result.profile,
        initialized: true,
      });

      if (result.error) {
        if (result.usedCache) {
          showToast('当前离线或网络受限，已加载本地缓存资料', 'info');
        } else {
          showToast('加载个人资料失败，请检查网络连接', 'error');
        }
      }
    };

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (initialHandled) {
          return;
        }
        initialHandled = true;
        void syncSession(data.session);
      })
      .catch(() => {
        if (isMounted && !initialHandled && latestSyncId === 0) {
          initialHandled = true;
          setInitialized(true);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'INITIAL_SESSION') {
        if (initialHandled) {
          return;
        }
        initialHandled = true;
      }
      if (event === 'SIGNED_OUT') {
        const prevUserId = useAuthStore.getState().session?.user.id;
        queryClient.clear();
        void clearCachedProfile(prevUserId).catch(() => undefined);
      }
      void syncSession(nextSession);
    });

    return () => {
      isMounted = false;
      latestSyncId += 1;
      subscription.unsubscribe();
    };
  }, [setAuthSnapshot, setInitialized, showToast]);

  useEffect(() => {
    let isMounted = true;

    const handleDeepLink = (url: string | null) => {
      if (!url || !isMounted) {
        return;
      }
      const code = extractRoomCodeFromUrl(url);
      if (code) {
        setPendingRoomCode(code);
      }
    };

    void Linking.getInitialURL()
      .then(handleDeepLink)
      .catch(() => undefined);

    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [setPendingRoomCode]);

  useEffect(() => {
    let isMounted = true;

    const inspectClipboardForInvite = async () => {
      try {
        const text = await Clipboard.getStringAsync();
        if (!isMounted || !text) {
          return;
        }
        const code = extractRoomCodeFromText(text);
        if (!code) {
          return;
        }
        const uiState = useUiStore.getState();
        if (uiState.lastHandledClipboardCode === code) {
          return;
        }

        // Skip auto-jumping to Join Room if the current user is already a member of that room
        const currentUid = useAuthStore.getState().session?.user.id;
        if (currentUid) {
          let roomsData = queryClient.getQueryData<MyRoomsResult>(
            QUERY_KEYS.rooms(currentUid),
          );
          if (!roomsData) {
            try {
              roomsData = await fetchMyRooms(currentUid);
              queryClient.setQueryData(QUERY_KEYS.rooms(currentUid), roomsData);
            } catch {
              roomsData = undefined;
            }
          }
          if (!isMounted) {
            return;
          }
          if (findJoinedRoomByCode(roomsData, code)) {
            uiState.markClipboardCodeHandled(code);
            return;
          }
        }

        uiState.markClipboardCodeHandled(code);
        setPendingRoomCode(code);
        showToast(`已识别剪贴板房间码 ${code}，正在前往进房页`, 'info');
      } catch {
        // Ignore clipboard read denials on OS/platform restrictions
      }
    };

    void inspectClipboardForInvite();

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void inspectClipboardForInvite();
      }
    });

    return () => {
      isMounted = false;
      appStateSub.remove();
    };
  }, [setPendingRoomCode, showToast]);

  const currentSegment = segments.length > 0 ? segments.join('/') : undefined;

  useEffect(() => {
    if (!rootNavigationState?.key) {
      return;
    }

    const step = computeNavigationStep({
      initialized,
      hasSession: Boolean(session),
      hasProfile: Boolean(profile),
      pendingRoomCode,
      currentSegment,
      inFlightJoinTarget: inFlightJoinTargetRef.current,
    });

    inFlightJoinTargetRef.current = step.nextInFlightJoinTarget;

    if (step.shouldClearPendingRoomCode) {
      clearPendingRoomCode();
    }

    if (step.action === 'replace' && step.target) {
      router.replace(step.target as Href);
    } else if (step.action === 'push' && step.target) {
      router.push(step.target as Href);
    }
  }, [
    rootNavigationState?.key,
    initialized,
    session,
    profile,
    pendingRoomCode,
    currentSegment,
    clearPendingRoomCode,
    router,
  ]);

  return (
    <View className="flex-1 bg-surface">
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: THEME_COLORS.surface },
        }}
      />
      {!initialized ? (
        <View className="absolute inset-0 items-center justify-center bg-surface">
          <ActivityIndicator size="large" color={THEME_COLORS.primary} />
          <Text className="mt-3 text-sm font-medium text-inkMuted">
            正在进入轻橘 PopRoom...
          </Text>
        </View>
      ) : null}
      <ToastOverlay />
    </View>
  );
}

/** Root Expo Router layout wiring gesture handling, persisted React Query cache, and bottom sheets. */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: asyncStoragePersister }}
        >
          <BottomSheetModalProvider>
            <RootNavigator />
          </BottomSheetModalProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
