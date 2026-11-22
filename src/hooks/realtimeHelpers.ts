import type { MemberStatus } from '../types/database';

/** Query key tuple union matching `QUERY_KEYS` in `src/lib/queryClient.ts`. */
export type RealtimeQueryKey =
  | readonly ['rooms']
  | readonly ['room', string]
  | readonly ['room', string, 'members']
  | readonly ['room', string, 'blocks']
  | readonly ['room', string, 'pollTallies']
  | readonly ['item', string, 'comments']
  | readonly ['room', string, 'activityLogs']
  | readonly ['room', string, 'messages'];

/**
 * Maps a Supabase Realtime `postgres_changes` table event inside a room to all
 * TanStack Query keys that must be invalidated.
 *
 * Critical invariant: `block_items` invalidates BOTH `roomBlocks(roomId)` AND
 * `roomPollTallies(roomId)` because `toggle_poll_vote` signals updates via
 * `block_items.updated_at` while `poll_votes` stays excluded from Realtime.
 */
export function getInvalidationKeysForRealtimeEvent(
  roomId: string,
  table: string,
  itemId?: string,
): RealtimeQueryKey[] {
  switch (table) {
    case 'rooms':
      return [['room', roomId], ['rooms']];
    case 'room_members':
      return [['room', roomId, 'members'], ['rooms']];
    case 'blocks':
    case 'block_items':
      return [
        ['room', roomId, 'blocks'],
        ['room', roomId, 'pollTallies'],
      ];
    case 'item_comments':
      return itemId ? [['item', itemId, 'comments']] : [];
    case 'activity_logs':
      return [['room', roomId, 'activityLogs']];
    case 'room_messages':
      return [['room', roomId, 'messages']];
    default:
      return [];
  }
}

/** Checks whether a Realtime `room_members` payload indicates the current user was kicked. */
export function isCurrentUserKickedEvent(
  row: unknown,
  currentUserId: string | null,
): boolean {
  if (!currentUserId || !row || typeof row !== 'object') {
    return false;
  }
  const record = row as { user_id?: unknown; status?: unknown };
  return (
    record.user_id === currentUserId &&
    (record.status as MemberStatus | undefined) === 'kicked'
  );
}

/** Safely extracts `item_id` from a Realtime `item_comments` `new` or `old` row payload. */
export function extractCommentItemId(
  newRow: unknown,
  oldRow: unknown,
): string | undefined {
  for (const candidate of [newRow, oldRow]) {
    if (candidate && typeof candidate === 'object') {
      const itemId = (candidate as { item_id?: unknown }).item_id;
      if (typeof itemId === 'string' && itemId.trim()) {
        return itemId;
      }
    }
  }
  return undefined;
}
