import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ProfileRow } from '../types/database';
import { createProfileCache } from './profileCacheHelpers';

export * from './profileCacheHelpers';

/** Shared AsyncStorage-backed profile cache enabling offline cold starts. */
export const profileCache = createProfileCache(AsyncStorage);

/** Loads a cached `ProfileRow` for `userId` from AsyncStorage, or `null` if unavailable. */
export function loadCachedProfile(userId: string): Promise<ProfileRow | null> {
  return profileCache.load(userId);
}

/** Persists the user's `ProfileRow` in AsyncStorage under `POPROOM_PROFILE_CACHE:${userId}`. */
export function saveCachedProfile(profile: ProfileRow): Promise<void> {
  return profileCache.save(profile);
}

/** Removes cached profile entries for `userId` (or all cached profiles if `userId` is omitted). */
export function clearCachedProfile(userId?: string): Promise<void> {
  return profileCache.clear(userId);
}
