import type { ProfileRow } from '../types/database';

/** Key prefix for persisting the authenticated user's profile in AsyncStorage. */
export const PROFILE_CACHE_KEY_PREFIX = 'POPROOM_PROFILE_CACHE:' as const;

/** Minimal async key-value storage contract implemented by AsyncStorage and in-memory test doubles. */
export interface ProfileStorageAdapter {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  getAllKeys?: () => Promise<readonly string[]>;
  multiRemove?: (keys: readonly string[]) => Promise<void>;
}

/** Cache adapter for saving, loading, and clearing a user's `ProfileRow`. */
export interface ProfileCache {
  load: (userId: string) => Promise<ProfileRow | null>;
  save: (profile: ProfileRow) => Promise<void>;
  clear: (userId?: string) => Promise<void>;
}

/** Returns the storage key for a given user's cached `ProfileRow`. */
export function getProfileCacheKey(userId: string): string {
  return `${PROFILE_CACHE_KEY_PREFIX}${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates and parses serialized JSON back into a `ProfileRow`, returning `null` on invalid payloads. */
export function parseCachedProfile(
  raw: string | null,
  expectedUserId?: string,
): ProfileRow | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
  const nickname =
    typeof parsed.nickname === 'string' ? parsed.nickname.trim() : '';
  const avatarColor =
    typeof parsed.avatar_color === 'string' ? parsed.avatar_color.trim() : '';

  if (!id || !nickname || !avatarColor) {
    return null;
  }

  if (expectedUserId && id !== expectedUserId) {
    return null;
  }

  return {
    id,
    nickname,
    avatar_color: avatarColor,
    avatar_url:
      typeof parsed.avatar_url === 'string' ? parsed.avatar_url : null,
    expo_push_token:
      typeof parsed.expo_push_token === 'string'
        ? parsed.expo_push_token
        : null,
    created_at:
      typeof parsed.created_at === 'string' ? parsed.created_at : '',
    updated_at:
      typeof parsed.updated_at === 'string' ? parsed.updated_at : '',
  };
}

/** Builds a resilient `ProfileCache` around an injected `ProfileStorageAdapter`. */
export function createProfileCache(storage: ProfileStorageAdapter): ProfileCache {
  return {
    load: async (userId: string): Promise<ProfileRow | null> => {
      const trimmedId = userId.trim();
      if (!trimmedId) {
        return null;
      }
      try {
        const raw = await storage.getItem(getProfileCacheKey(trimmedId));
        return parseCachedProfile(raw, trimmedId);
      } catch {
        return null;
      }
    },

    save: async (profile: ProfileRow): Promise<void> => {
      const trimmedId = profile.id.trim();
      if (!trimmedId) {
        return;
      }
      try {
        await storage.setItem(
          getProfileCacheKey(trimmedId),
          JSON.stringify(profile),
        );
      } catch {
        // Ignore non-fatal local cache write failures so online flows keep working.
      }
    },

    clear: async (userId?: string): Promise<void> => {
      const trimmedId = userId?.trim();
      try {
        if (trimmedId) {
          await storage.removeItem(getProfileCacheKey(trimmedId));
          return;
        }

        if (storage.getAllKeys) {
          const allKeys = await storage.getAllKeys();
          const cacheKeys = allKeys.filter((key) =>
            key.startsWith(PROFILE_CACHE_KEY_PREFIX),
          );
          if (cacheKeys.length === 0) {
            return;
          }
          if (storage.multiRemove) {
            await storage.multiRemove(cacheKeys);
          } else {
            await Promise.all(cacheKeys.map((key) => storage.removeItem(key)));
          }
        }
      } catch {
        // Ignore storage cleanup errors during sign-out.
      }
    },
  };
}
