import '../global.css';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import type { Session } from '@supabase/supabase-js';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
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
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { asyncStoragePersister, queryClient } from '../src/lib/queryClient';
import { clearCachedProfile, profileCache } from '../src/lib/profileCache';
import { extractRoomCodeFromUrl } from '../src/lib/roomCode';
import { fetchProfileByUserId, supabase } from '../src/lib/supabase';
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

const TOAST_BG_CLASSES: Record<ToastVariant, string> = {
  info: 'bg-ink',
  success: 'bg-emerald-600',
  error: 'bg-red-600',
};

function ToastIcon({ type }: { type: ToastVariant }) {
  if (type === 'success') {
    return <CheckCircle2 size={18} color="#FFFFFF" />;
  }
  if (type === 'error') {
    return <AlertCircle size={18} color="#FFFFFF" />;
  }
  return <Info size={18} color="#FFFFFF" />;
}

/** Global top toast banner overlay reading from `useUiStore`. */
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

  return (
    <View
      pointerEvents="box-none"
      style={{ top: insets.top + 8 }}
      className="absolute left-4 right-4 z-50"
    >
      <Pressable
        accessibilityRole="alert"
        onPress={() => dismissToast(toast.id)}
        className={`flex-row items-center gap-2.5 rounded-2xl px-4 py-3 shadow-md ${TOAST_BG_CLASSES[toast.type]}`}
      >
        <ToastIcon type={toast.type} />
        <Text className="flex-1 text-sm font-medium text-white">
          {toast.message}
        </Text>
        <X size={16} color="#FFFFFF" />
      </Pressable>
    </View>
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
          contentStyle: { backgroundColor: '#F8FAFC' },
        }}
      />
      {!initialized ? (
        <View className="absolute inset-0 items-center justify-center bg-surface">
          <ActivityIndicator size="large" color="#F97316" />
          <Text className="mt-3 text-sm font-medium text-zinc-500">
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
