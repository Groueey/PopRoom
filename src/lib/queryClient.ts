import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';

const TWENTY_FOUR_HOURS_MS = 1000 * 60 * 60 * 24;
const THIRTY_SECONDS_MS = 1000 * 30;

/** Shared TanStack Query client configured for offline-friendly PopRoom caching. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: TWENTY_FOUR_HOURS_MS,
      staleTime: THIRTY_SECONDS_MS,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

/** Persister storing TanStack Query cache snapshots in AsyncStorage for offline read access. */
export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'POPROOM_QUERY_CACHE',
});

/** Typed query key factory shared across room, block, poll, comment, and log queries. */
export const QUERY_KEYS = {
  rooms: (userId?: string) =>
    userId ? (['rooms', userId] as const) : (['rooms'] as const),
  roomDetail: (roomId: string) => ['room', roomId] as const,
  roomMembers: (roomId: string) => ['room', roomId, 'members'] as const,
  roomBlocks: (roomId: string) => ['room', roomId, 'blocks'] as const,
  roomPollTallies: (roomId: string) => ['room', roomId, 'pollTallies'] as const,
  itemComments: (itemId: string) => ['item', itemId, 'comments'] as const,
  activityLogs: (roomId: string) => ['room', roomId, 'activityLogs'] as const,
} as const;
