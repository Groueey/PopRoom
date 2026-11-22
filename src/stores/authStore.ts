import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';
import { isValidRoomCode, normalizeRoomCode } from '../lib/roomCode';
import type { ProfileRow } from '../types/database';

/** Preset avatar color swatches anchored by PopRoom primary tangerine. */
export const AVATAR_COLORS = [
  '#F97316',
  '#FB923C',
  '#EF4444',
  '#EC4899',
  '#8B5CF6',
  '#3B82F6',
  '#06B6D4',
  '#10B981',
  '#EAB308',
  '#64748B',
] as const;

/** Input state evaluated by `resolveAuthRedirect` for root navigation guarding. */
export interface AuthRedirectState {
  initialized: boolean;
  hasSession: boolean;
  hasProfile: boolean;
  pendingRoomCode: string | null;
  currentSegment: string | undefined;
}

/**
 * Pure route guard deciding where the root layout should redirect based on auth,
 * profile completeness, current route segment, and any queued invite room code.
 */
export function resolveAuthRedirect(state: AuthRedirectState): string | null {
  if (!state.initialized) {
    return null;
  }

  const normalizedSegment = state.currentSegment?.replace(/^\/+/, '');
  const isAuthGroup =
    normalizedSegment === '(auth)' || Boolean(normalizedSegment?.startsWith('(auth)/'));
  const isLoginRoute =
    normalizedSegment === '(auth)' || normalizedSegment === '(auth)/login';
  const isOnboardingRoute = normalizedSegment === '(auth)/onboarding';

  if (!state.hasSession) {
    return isLoginRoute ? null : '/(auth)/login';
  }

  if (!state.hasProfile) {
    return isOnboardingRoute ? null : '/(auth)/onboarding';
  }

  const pendingCode = state.pendingRoomCode?.trim();
  if (pendingCode) {
    return `/room/join?code=${pendingCode}`;
  }

  if (!normalizedSegment || isAuthGroup) {
    return '/(tabs)';
  }

  return null;
}

/** Input state for `computeNavigationStep`, adding in-flight `/room/join` deduplication state. */
export interface NavigationStepInput extends AuthRedirectState {
  inFlightJoinTarget: string | null;
}

/** Pure navigation effect plan preventing premature `pendingRoomCode` clearing before `room/join` mounts. */
export interface NavigationStepResult {
  action: 'none' | 'replace' | 'push';
  target: string | null;
  nextInFlightJoinTarget: string | null;
  shouldClearPendingRoomCode: boolean;
}

/**
 * Computes the next root navigation transition without clearing `pendingRoomCode` until
 * `currentSegment` actually arrives at `room/join`, preventing intermediate re-renders
 * from falling back to `/(tabs)` and clobbering the deep-link transition.
 */
export function computeNavigationStep(
  state: NavigationStepInput,
): NavigationStepResult {
  const target = resolveAuthRedirect(state);
  const normalizedSegment = state.currentSegment?.replace(/^\/+/, '');

  if (!target) {
    return {
      action: 'none',
      target: null,
      nextInFlightJoinTarget: null,
      shouldClearPendingRoomCode: false,
    };
  }

  if (target.startsWith('/room/join')) {
    if (normalizedSegment === 'room/join') {
      if (state.inFlightJoinTarget === target) {
        return {
          action: 'none',
          target: null,
          nextInFlightJoinTarget: null,
          shouldClearPendingRoomCode: true,
        };
      }
      return {
        action: 'replace',
        target,
        nextInFlightJoinTarget: null,
        shouldClearPendingRoomCode: true,
      };
    }

    if (state.inFlightJoinTarget === target) {
      return {
        action: 'none',
        target: null,
        nextInFlightJoinTarget: target,
        shouldClearPendingRoomCode: false,
      };
    }

    const shouldReplace =
      !normalizedSegment ||
      normalizedSegment.startsWith('(auth)') ||
      state.inFlightJoinTarget !== null;
    return {
      action: shouldReplace ? 'replace' : 'push',
      target,
      nextInFlightJoinTarget: target,
      shouldClearPendingRoomCode: false,
    };
  }

  return {
    action: 'replace',
    target,
    nextInFlightJoinTarget: null,
    shouldClearPendingRoomCode: false,
  };
}

/** Async loader returning a user's `ProfileRow` or `null` if not yet onboarded. */
export type ProfileFetcher = (userId: string) => Promise<ProfileRow | null>;

/** Platform-agnostic profile cache adapter so `authStore` stays Node-safe in Vitest. */
export interface ProfileCacheAdapter {
  load: (userId: string) => Promise<ProfileRow | null>;
  save: (profile: ProfileRow) => Promise<void>;
  clear: (userId?: string) => Promise<void>;
}

/** Result returned by `loadProfileWithFallback` for online and offline session sync. */
export interface FetchProfileFallbackResult {
  profile: ProfileRow | null;
  usedCache: boolean;
  error: unknown | null;
}

let registeredProfileFetcher: ProfileFetcher | null = null;
let registeredProfileCache: ProfileCacheAdapter | null = null;

/** Registers the platform profile fetcher so `authStore` stays free of native imports in Node tests. */
export function registerProfileFetcher(fetcher: ProfileFetcher | null): void {
  registeredProfileFetcher = fetcher;
}

/** Registers the platform profile cache adapter for cold-start offline fallback. */
export function registerProfileCache(cache: ProfileCacheAdapter | null): void {
  registeredProfileCache = cache;
}

/**
 * Fetches a user's `ProfileRow` from the server and persists it on success.
 * If the network fetch throws (e.g., offline cold boot), falls back to an in-memory
 * or persisted cached profile for the same `userId` so returning users are not
 * erroneously routed back to onboarding.
 */
export async function loadProfileWithFallback(
  userId: string,
  options: {
    inMemoryProfile?: ProfileRow | null;
    fetcher: ProfileFetcher;
    cache?: ProfileCacheAdapter | null;
  },
): Promise<FetchProfileFallbackResult> {
  const activeCache = options.cache ?? registeredProfileCache;

  try {
    const profile = await options.fetcher(userId);
    if (profile) {
      await activeCache?.save(profile).catch(() => undefined);
    } else {
      await activeCache?.clear(userId).catch(() => undefined);
    }
    return { profile, usedCache: false, error: null };
  } catch (err) {
    if (options.inMemoryProfile && options.inMemoryProfile.id === userId) {
      return { profile: options.inMemoryProfile, usedCache: true, error: err };
    }

    const cached = await activeCache?.load(userId).catch(() => null);
    if (cached && cached.id === userId) {
      return { profile: cached, usedCache: true, error: err };
    }

    return { profile: null, usedCache: false, error: err };
  }
}

interface AuthStoreState {
  session: Session | null;
  profile: ProfileRow | null;
  initialized: boolean;
  pendingRoomCode: string | null;
  setSession: (session: Session | null) => void;
  setProfile: (profile: ProfileRow | null) => void;
  setInitialized: (initialized: boolean) => void;
  setAuthSnapshot: (snapshot: {
    session: Session | null;
    profile: ProfileRow | null;
    initialized?: boolean;
  }) => void;
  setPendingRoomCode: (code: string | null) => void;
  clearPendingRoomCode: () => void;
  refreshProfile: (
    userId?: string,
    fetcher?: ProfileFetcher,
  ) => Promise<ProfileRow | null>;
}

/** Global Zustand store holding Supabase session, profile, boot flag, and deferred deep-link room code. */
export const useAuthStore = create<AuthStoreState>((set, get) => ({
  session: null,
  profile: null,
  initialized: false,
  pendingRoomCode: null,

  setSession: (session) => set({ session }),

  setProfile: (profile) => {
    set({ profile });
    if (profile && registeredProfileCache) {
      void registeredProfileCache.save(profile).catch(() => undefined);
    }
  },

  setInitialized: (initialized) => set({ initialized }),

  setAuthSnapshot: ({ session, profile, initialized }) =>
    set((prev) => ({
      session,
      profile,
      initialized: initialized ?? prev.initialized,
    })),

  setPendingRoomCode: (code) => {
    if (!code) {
      set({ pendingRoomCode: null });
      return;
    }
    const normalized = normalizeRoomCode(code);
    set({ pendingRoomCode: isValidRoomCode(normalized) ? normalized : null });
  },

  clearPendingRoomCode: () => set({ pendingRoomCode: null }),

  refreshProfile: async (userId, fetcher) => {
    const targetUserId = userId ?? get().session?.user.id;
    if (!targetUserId) {
      set({ profile: null });
      return null;
    }
    const activeFetcher = fetcher ?? registeredProfileFetcher;
    if (!activeFetcher) {
      throw new Error(
        'Profile fetcher is not registered. Call registerProfileFetcher() in app root.',
      );
    }
    const profile = await activeFetcher(targetUserId);
    if (profile && registeredProfileCache) {
      await registeredProfileCache.save(profile).catch(() => undefined);
    } else if (!profile && registeredProfileCache) {
      await registeredProfileCache.clear(targetUserId).catch(() => undefined);
    }
    set({ profile });
    return profile;
  },
}));
