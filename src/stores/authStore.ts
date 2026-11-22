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

let registeredProfileFetcher: ProfileFetcher | null = null;

/** Registers the platform profile fetcher so `authStore` stays free of native imports in Node tests. */
export function registerProfileFetcher(fetcher: ProfileFetcher | null): void {
  registeredProfileFetcher = fetcher;
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

  setProfile: (profile) => set({ profile }),

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
    set({ profile });
    return profile;
  },
}));
