import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { QUERY_KEYS } from '../lib/queryClient';
import { supabase } from '../lib/supabase';
import { useUiStore } from '../stores/uiStore';
import {
  type RealtimeQueryKey,
  extractCommentItemId,
  getInvalidationKeysForRealtimeEvent,
  isCurrentUserKickedEvent,
} from './realtimeHelpers';

export * from './realtimeHelpers';

type AppQueryKey = ReturnType<(typeof QUERY_KEYS)[keyof typeof QUERY_KEYS]>;
// Compile-time check guaranteeing `realtimeHelpers.ts` tuple shapes match `QUERY_KEYS`.
const _verifyRealtimeKeyCompatibility: (k: RealtimeQueryKey) => AppQueryKey = (
  key,
) => key;
void _verifyRealtimeKeyCompatibility;

/**
 * Opens a single room-scoped Supabase Realtime channel (`room:${roomId}`) listening to
 * `rooms`, `room_members`, `blocks`, `block_items`, and `item_comments`.
 * Automatically invalidates affected TanStack Query keys and ejects the current user if kicked.
 */
export function useRoomRealtime(
  roomId: string,
  currentUserId: string | null,
): void {
  const queryClient = useQueryClient();
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  const kickedHandledRef = useRef(false);

  useEffect(() => {
    kickedHandledRef.current = false;
  }, [roomId, currentUserId]);

  useEffect(() => {
    if (!roomId) {
      return undefined;
    }

    const invalidateForTable = (table: string, itemId?: string) => {
      const keys = getInvalidationKeysForRealtimeEvent(roomId, table, itemId);
      for (const queryKey of keys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        () => {
          invalidateForTable('rooms');
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_members',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (isCurrentUserKickedEvent(payload.new, currentUserId)) {
            if (kickedHandledRef.current) {
              return;
            }
            kickedHandledRef.current = true;
            void queryClient.invalidateQueries({
              queryKey: QUERY_KEYS.rooms(currentUserId ?? undefined),
            });
            queryClient.removeQueries({
              queryKey: QUERY_KEYS.roomDetail(roomId),
            });
            showToast('你已被移出该房间', 'error');
            router.replace('/(tabs)');
            return;
          }
          invalidateForTable('room_members');
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'blocks',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          invalidateForTable('blocks');
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'block_items',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          invalidateForTable('block_items');
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'item_comments',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const itemId = extractCommentItemId(payload.new, payload.old);
          invalidateForTable('item_comments', itemId);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, queryClient, roomId, router, showToast]);
}
