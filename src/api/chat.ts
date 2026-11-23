import { ZodError } from 'zod';
import { RoomApiError, mapRoomError, toRoomApiError } from '../api/roomHelpers';
import {
  type ParsedRoomMessage,
  parseChatMessagesSafely,
  parseSingleChatMessage,
  validateChatMessageInput,
  validateReportReasonInput,
} from '../lib/chatHelpers';
import { supabase } from '../lib/supabase';
import {
  type ChatMessageMetadata,
  ChatMessageMetadataSchema,
} from '../schemas/blocks';
import type {
  BlockedUserWithProfile,
  ProfileSummary,
  RoomMessageRow,
  RoomMessageWithSender,
  UserBlockRow,
} from '../types/database';

export * from '../lib/chatHelpers';

const ROOM_MESSAGE_COLUMNS =
  'id, room_id, sender_id, msg_type, content, metadata, is_deleted, created_at, profiles(id, nickname, avatar_color, avatar_url)';

const USER_BLOCK_COLUMNS =
  'blocker_id, blocked_id, created_at, profiles:profiles!user_blocks_blocked_id_fkey(id, nickname, avatar_color, avatar_url)';

interface RawRoomMessageWithSenderRow extends RoomMessageRow {
  profiles: ProfileSummary | ProfileSummary[] | null;
}

interface RawBlockedUserWithProfileRow extends UserBlockRow {
  profiles: ProfileSummary | ProfileSummary[] | null;
}

function normalizeProfileSummary(
  raw: ProfileSummary | ProfileSummary[] | null | undefined,
): ProfileSummary | null {
  if (!raw) {
    return null;
  }
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

/** Input payload for `sendRoomMessage`. */
export interface SendRoomMessageInput {
  roomId: string;
  msgType?: 'text' | 'block_card';
  content: string;
  metadata?: Partial<ChatMessageMetadata>;
}

/** Fetches up to the latest 200 non-deleted chat messages for a room ordered chronologically. */
export async function fetchRoomMessages(
  roomId: string,
): Promise<ParsedRoomMessage[]> {
  const { data, error } = await supabase
    .from('room_messages')
    .select(ROOM_MESSAGE_COLUMNS)
    .eq('room_id', roomId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    throw toRoomApiError(error);
  }

  const rows = (data ?? []) as unknown as RawRoomMessageWithSenderRow[];
  const normalized: RoomMessageWithSender[] = rows.map((row) => ({
    id: row.id,
    room_id: row.room_id,
    sender_id: row.sender_id,
    msg_type: row.msg_type,
    content: row.content,
    metadata: row.metadata,
    is_deleted: row.is_deleted,
    created_at: row.created_at,
    profiles: normalizeProfileSummary(row.profiles),
  }));

  return parseChatMessagesSafely(normalized);
}

/** Validates content & metadata, sends a room message via `send_room_message` RPC, and returns the parsed message. */
export async function sendRoomMessage(
  input: SendRoomMessageInput,
): Promise<ParsedRoomMessage> {
  const validatedContent = validateChatMessageInput(input.content);
  let validatedMetadata: ChatMessageMetadata;
  try {
    validatedMetadata = ChatMessageMetadataSchema.parse(input.metadata ?? {});
  } catch (err) {
    if (err instanceof ZodError) {
      throw new RoomApiError('INVALID_INPUT', '消息附加信息格式有误');
    }
    throw toRoomApiError(err);
  }

  const msgType = input.msgType ?? 'text';
  const { data, error } = await supabase.rpc('send_room_message', {
    p_room_id: input.roomId,
    p_msg_type: msgType,
    p_content: validatedContent,
    p_metadata: validatedMetadata,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('UNKNOWN_ERROR', mapRoomError('UNKNOWN_ERROR'));
  }

  const row = data as unknown as RawRoomMessageWithSenderRow;
  return parseSingleChatMessage({
    id: row.id,
    room_id: row.room_id,
    sender_id: row.sender_id,
    msg_type: row.msg_type,
    content: row.content,
    metadata: row.metadata,
    is_deleted: row.is_deleted,
    created_at: row.created_at,
    profiles: normalizeProfileSummary(row.profiles),
  });
}

/** Soft-deletes a room message via `soft_delete_room_message` RPC (author or room admin). */
export async function softDeleteRoomMessage(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('soft_delete_room_message', {
    p_message_id: messageId,
  });

  if (error) {
    throw toRoomApiError(error);
  }
}

/** Submits a UGC report for a room message via `report_room_message` RPC. */
export async function reportRoomMessage(
  messageId: string,
  reason: string,
): Promise<void> {
  const trimmed = validateReportReasonInput(reason);
  const { error } = await supabase.rpc('report_room_message', {
    p_message_id: messageId,
    p_reason: trimmed,
  });

  if (error) {
    throw toRoomApiError(error);
  }
}

/** Fetches all users blocked by `userId` with their public profile summaries. */
export async function fetchMyBlockedUsers(
  userId: string,
): Promise<BlockedUserWithProfile[]> {
  if (!userId) {
    return [];
  }

  const { data, error } = await supabase
    .from('user_blocks')
    .select(USER_BLOCK_COLUMNS)
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw toRoomApiError(error);
  }

  const rows = (data ?? []) as unknown as RawBlockedUserWithProfileRow[];
  return rows.map((row) => ({
    blocker_id: row.blocker_id,
    blocked_id: row.blocked_id,
    created_at: row.created_at,
    profiles: normalizeProfileSummary(row.profiles),
  }));
}

/** Blocks another user (`blockerId !== blockedId`) idempotently in `public.user_blocks`. */
export async function blockUser(
  blockerId: string,
  blockedId: string,
): Promise<void> {
  if (blockerId === blockedId) {
    throw new RoomApiError(
      'CANNOT_BLOCK_SELF',
      mapRoomError('CANNOT_BLOCK_SELF'),
    );
  }

  const { error } = await supabase
    .from('user_blocks')
    .upsert(
      { blocker_id: blockerId, blocked_id: blockedId },
      { onConflict: 'blocker_id,blocked_id' },
    );

  if (error) {
    throw toRoomApiError(error);
  }
}

/** Removes a user block entry from `public.user_blocks`. */
export async function unblockUser(
  blockerId: string,
  blockedId: string,
): Promise<void> {
  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);

  if (error) {
    throw toRoomApiError(error);
  }
}

/** Fetches the current user's `last_read_at` cursor for a room's chat, or `null` if unread. */
export async function fetchRoomChatRead(
  roomId: string,
  userId: string,
): Promise<string | null> {
  if (!roomId || !userId) {
    return null;
  }

  const { data, error } = await supabase
    .from('room_chat_reads')
    .select('last_read_at')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw toRoomApiError(error);
  }

  return (data as { last_read_at?: string | null } | null)?.last_read_at ?? null;
}

/** Upserts the current user's `room_chat_reads` cursor (clamped to `>= minReadAtIso` when provided) and returns the persisted ISO timestamp. */
export async function markRoomChatRead(
  roomId: string,
  userId: string,
  minReadAtIso?: string,
): Promise<string> {
  const nowMs = Date.now();
  const minMs = minReadAtIso ? Date.parse(minReadAtIso) : Number.NaN;
  const effectiveIso =
    Number.isFinite(minMs) && minMs > nowMs
      ? new Date(minMs).toISOString()
      : new Date(nowMs).toISOString();

  const { error } = await supabase
    .from('room_chat_reads')
    .upsert(
      { room_id: roomId, user_id: userId, last_read_at: effectiveIso },
      { onConflict: 'room_id,user_id' },
    );

  if (error) {
    throw toRoomApiError(error);
  }

  return effectiveIso;
}
