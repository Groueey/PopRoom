import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAsyncStorageMap = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mockAsyncStorageMap.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      mockAsyncStorageMap.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      mockAsyncStorageMap.delete(key);
    }),
    getAllKeys: vi.fn(async () => [...mockAsyncStorageMap.keys()]),
    multiRemove: vi.fn(async (keys: readonly string[]) => {
      for (const key of keys) {
        mockAsyncStorageMap.delete(key);
      }
    }),
  },
}));

import {
  clearCachedProfile,
  loadCachedProfile,
  saveCachedProfile,
} from '@/src/lib/profileCache';
import {
  PROFILE_CACHE_KEY_PREFIX,
  type ProfileStorageAdapter,
  createProfileCache,
  getProfileCacheKey,
  parseCachedProfile,
} from '@/src/lib/profileCacheHelpers';
import {
  loadProfileWithFallback,
  registerProfileCache,
  registerProfileFetcher,
  resolveAuthRedirect,
  useAuthStore,
} from '@/src/stores/authStore';
import type { ProfileRow } from '@/src/types/database';

function makeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: 'user-1',
    nickname: '阿橘',
    avatar_color: '#F97316',
    avatar_url: null,
    expo_push_token: null,
    created_at: '2026-11-22T00:00:00Z',
    updated_at: '2026-11-22T00:00:00Z',
    ...overrides,
  };
}

function createMemoryStorage(): {
  adapter: ProfileStorageAdapter;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    adapter: {
      getItem: async (key) => store.get(key) ?? null,
      setItem: async (key, value) => {
        store.set(key, value);
      },
      removeItem: async (key) => {
        store.delete(key);
      },
      getAllKeys: async () => [...store.keys()],
      multiRemove: async (keys) => {
        for (const key of keys) {
          store.delete(key);
        }
      },
    },
  };
}

describe('profileCacheHelpers', () => {
  it('keys cached profiles by POPROOM_PROFILE_CACHE:${userId}', () => {
    expect(PROFILE_CACHE_KEY_PREFIX).toBe('POPROOM_PROFILE_CACHE:');
    expect(getProfileCacheKey('user-123')).toBe(
      'POPROOM_PROFILE_CACHE:user-123',
    );
  });

  it('saves, loads, and clears ProfileRow in storage safely', async () => {
    const { adapter, store } = createMemoryStorage();
    const cache = createProfileCache(adapter);
    const profile = makeProfile({ id: 'u-abc', nickname: '小满' });

    await cache.save(profile);
    expect(store.has('POPROOM_PROFILE_CACHE:u-abc')).toBe(true);

    const loaded = await cache.load('u-abc');
    expect(loaded).toEqual(profile);

    await cache.clear('u-abc');
    expect(await cache.load('u-abc')).toBeNull();
  });

  it('rejects corrupted JSON or mismatched userId payloads cleanly', () => {
    expect(parseCachedProfile(null, 'user-1')).toBeNull();
    expect(parseCachedProfile('{bad json', 'user-1')).toBeNull();
    expect(
      parseCachedProfile(JSON.stringify(makeProfile({ id: 'user-2' })), 'user-1'),
    ).toBeNull();
    expect(
      parseCachedProfile(
        JSON.stringify({ id: 'user-1', nickname: '' }),
        'user-1',
      ),
    ).toBeNull();
  });

  it('clears all POPROOM_PROFILE_CACHE keys when clear is called without userId', async () => {
    const { adapter, store } = createMemoryStorage();
    const cache = createProfileCache(adapter);
    store.set('POPROOM_PROFILE_CACHE:u1', JSON.stringify(makeProfile({ id: 'u1' })));
    store.set('POPROOM_PROFILE_CACHE:u2', JSON.stringify(makeProfile({ id: 'u2' })));
    store.set('OTHER_KEY', 'keep-me');

    await cache.clear();

    expect(store.has('POPROOM_PROFILE_CACHE:u1')).toBe(false);
    expect(store.has('POPROOM_PROFILE_CACHE:u2')).toBe(false);
    expect(store.get('OTHER_KEY')).toBe('keep-me');
  });

  it('persists and clears via src/lib/profileCache.ts AsyncStorage singleton', async () => {
    mockAsyncStorageMap.clear();
    const profile = makeProfile({ id: 'u-async', nickname: '异步橘' });

    await saveCachedProfile(profile);
    expect(mockAsyncStorageMap.has('POPROOM_PROFILE_CACHE:u-async')).toBe(true);
    expect(await loadCachedProfile('u-async')).toEqual(profile);

    await clearCachedProfile('u-async');
    expect(await loadCachedProfile('u-async')).toBeNull();
  });
});

describe('loadProfileWithFallback (Critical #1 offline cold-start)', () => {
  beforeEach(() => {
    registerProfileFetcher(null);
    registerProfileCache(null);
    useAuthStore.setState({
      session: null,
      profile: null,
      initialized: false,
      pendingRoomCode: null,
    });
  });

  it('persists fetched profile on online boot and falls back to cached profile on offline cold boot', async () => {
    const { adapter } = createMemoryStorage();
    const cache = createProfileCache(adapter);
    const profile = makeProfile({ id: 'u-cold', nickname: '离线橘' });

    // 1. Online boot caches the profile
    const onlineResult = await loadProfileWithFallback('u-cold', {
      inMemoryProfile: null,
      fetcher: async () => profile,
      cache,
    });
    expect(onlineResult).toEqual({
      profile,
      usedCache: false,
      error: null,
    });

    // 2. Cold offline boot (inMemoryProfile is null, fetcher throws network error)
    const networkErr = new Error('Network request failed');
    const offlineResult = await loadProfileWithFallback('u-cold', {
      inMemoryProfile: null,
      fetcher: async () => {
        throw networkErr;
      },
      cache,
    });

    expect(offlineResult.profile).toEqual(profile);
    expect(offlineResult.usedCache).toBe(true);
    expect(offlineResult.error).toBe(networkErr);

    // Offline returning user must NOT be kicked into /(auth)/onboarding
    const redirect = resolveAuthRedirect({
      initialized: true,
      hasSession: true,
      hasProfile: Boolean(offlineResult.profile),
      pendingRoomCode: null,
      currentSegment: undefined,
    });
    expect(redirect).toBe('/(tabs)');
  });

  it('clears stale cached profile when server confirms profile is null', async () => {
    const { adapter } = createMemoryStorage();
    const cache = createProfileCache(adapter);
    await cache.save(makeProfile({ id: 'u-reset' }));

    const result = await loadProfileWithFallback('u-reset', {
      inMemoryProfile: null,
      fetcher: async () => null,
      cache,
    });

    expect(result).toEqual({ profile: null, usedCache: false, error: null });
    expect(await cache.load('u-reset')).toBeNull();
  });

  it('syncs registered cache on authStore setProfile and refreshProfile without native imports', async () => {
    const { adapter } = createMemoryStorage();
    const cache = createProfileCache(adapter);
    const saveSpy = vi.spyOn(cache, 'save');
    const profile = makeProfile({ id: 'u-store', nickname: '同步成员' });

    registerProfileCache(cache);
    registerProfileFetcher(async () => profile);

    await useAuthStore.getState().refreshProfile('u-store');
    expect(saveSpy).toHaveBeenCalledWith(profile);
    expect(await cache.load('u-store')).toEqual(profile);

    const updated = makeProfile({ id: 'u-store', nickname: '新昵称' });
    useAuthStore.getState().setProfile(updated);
    await Promise.resolve();
    expect(await cache.load('u-store')).toEqual(updated);
  });
});
