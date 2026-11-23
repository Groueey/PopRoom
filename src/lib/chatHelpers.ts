import type { ParsedBlock } from '../api/blockHelpers';
import { RoomApiError } from '../api/roomHelpers';
import {
  type ChatMessageMetadata,
  type PollTally,
  parseChatMessageMetadata,
} from '../schemas/blocks';
import type { ProfileSummary, RoomMessageWithSender } from '../types/database';

/** Maximum character length (Unicode code points) allowed for a single chat message. */
export const MAX_CHAT_MESSAGE_LENGTH = 1000;

/** Maximum character length (Unicode code points) allowed for a UGC report reason. */
export const MAX_REPORT_REASON_LENGTH = 300;

/** Preset Chinese report reasons presented when reporting a room chat message. */
export const REPORT_REASON_PRESETS = [
  '垃圾广告或刷屏',
  '不友善或人身攻击',
  '违法违规或敏感内容',
  '其他原因',
] as const;

const DEFAULT_CHAT_METADATA: ChatMessageMetadata = {
  mentionAll: false,
  mentionUserIds: [],
};

/** Validated `room_messages` row with Zod-parsed `metadata` and optional optimistic flag. */
export interface ParsedRoomMessage
  extends Omit<RoomMessageWithSender, 'metadata'> {
  metadata: ChatMessageMetadata;
  optimistic?: boolean;
}

/** Client-side draft payload used to render an optimistic chat bubble before RPC settlement. */
export interface OptimisticChatDraft {
  tempId: string;
  roomId: string;
  senderId: string;
  senderProfile: ProfileSummary | null;
  content: string;
  mentionAll?: boolean;
  mentionUserIds?: string[];
  createdAt?: string;
}

/** Validates and trims chat message text against `MAX_CHAT_MESSAGE_LENGTH` code points. */
export function validateChatMessageInput(content: string): string {
  const trimmed = typeof content === 'string' ? content.trim() : '';
  if (!trimmed) {
    throw new RoomApiError('INVALID_INPUT', '请输入消息内容');
  }
  if (Array.from(trimmed).length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new RoomApiError(
      'INVALID_INPUT',
      `消息内容不能超过 ${MAX_CHAT_MESSAGE_LENGTH} 个字`,
    );
  }
  return trimmed;
}

/** Validates and trims UGC report reason text against `MAX_REPORT_REASON_LENGTH` code points. */
export function validateReportReasonInput(reason: string): string {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (!trimmed) {
    throw new RoomApiError('INVALID_INPUT', '请输入举报原因');
  }
  if (Array.from(trimmed).length > MAX_REPORT_REASON_LENGTH) {
    throw new RoomApiError(
      'INVALID_INPUT',
      `举报原因不能超过 ${MAX_REPORT_REASON_LENGTH} 个字`,
    );
  }
  return trimmed;
}

/** Safely parses `metadata` for a single `RoomMessageWithSender`, falling back to defaults if malformed. */
export function parseSingleChatMessage(
  row: RoomMessageWithSender,
): ParsedRoomMessage {
  let metadata: ChatMessageMetadata;
  try {
    metadata = parseChatMessageMetadata(row.metadata);
  } catch (err) {
    console.warn(
      `[PopRoom] Falling back to default metadata for room_message "${row.id}":`,
      err,
    );
    metadata = {
      mentionAll: DEFAULT_CHAT_METADATA.mentionAll,
      mentionUserIds: [...DEFAULT_CHAT_METADATA.mentionUserIds],
    };
  }

  return {
    id: row.id,
    room_id: row.room_id,
    sender_id: row.sender_id,
    msg_type: row.msg_type,
    content: row.content,
    metadata,
    is_deleted: row.is_deleted,
    created_at: row.created_at,
    profiles: row.profiles,
  };
}

function compareMessagesAscending(
  a: ParsedRoomMessage,
  b: ParsedRoomMessage,
): number {
  const timeA = Date.parse(a.created_at);
  const timeB = Date.parse(b.created_at);
  if (!Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB) {
    return timeA - timeB;
  }
  return a.created_at.localeCompare(b.created_at);
}

/** Parses raw `room_messages` rows via `parseChatMessageMetadata` and sorts ascending by `created_at`. */
export function parseChatMessagesSafely(
  rows: readonly RoomMessageWithSender[],
): ParsedRoomMessage[] {
  return rows.map(parseSingleChatMessage).sort(compareMessagesAscending);
}

/** Client-side defense-in-depth filter excluding soft-deleted rows and blocked senders. */
export function filterVisibleChatMessages(
  messages: readonly ParsedRoomMessage[],
  blockedUserIds: ReadonlySet<string>,
): ParsedRoomMessage[] {
  return messages.filter(
    (msg) => msg.is_deleted !== true && !blockedUserIds.has(msg.sender_id),
  );
}

/**
 * Counts unread visible chat messages strictly after `lastReadAt`, never counting
 * self-authored, soft-deleted, or blocked-user messages.
 */
export function countUnreadChatMessages(
  messages: readonly ParsedRoomMessage[],
  lastReadAt: string | null,
  currentUserId: string | null,
  blockedUserIds: ReadonlySet<string>,
): number {
  const visible = filterVisibleChatMessages(messages, blockedUserIds);
  const lastReadMs = lastReadAt !== null ? Date.parse(lastReadAt) : Number.NaN;
  const hasValidCursor = lastReadAt !== null && !Number.isNaN(lastReadMs);

  let unreadCount = 0;
  for (const message of visible) {
    if (currentUserId !== null && message.sender_id === currentUserId) {
      continue;
    }
    if (!hasValidCursor) {
      unreadCount += 1;
      continue;
    }
    const msgMs = Date.parse(message.created_at);
    if (!Number.isNaN(msgMs) && msgMs > lastReadMs) {
      unreadCount += 1;
    }
  }
  return unreadCount;
}

/** Returns a new message array with an optimistic draft appended at the end. */
export function appendOptimisticChatMessage(
  existing: readonly ParsedRoomMessage[],
  draft: OptimisticChatDraft,
): ParsedRoomMessage[] {
  const optimisticMessage: ParsedRoomMessage = {
    id: draft.tempId,
    room_id: draft.roomId,
    sender_id: draft.senderId,
    msg_type: 'text',
    content: draft.content,
    metadata: parseChatMessageMetadata({
      mentionAll: Boolean(draft.mentionAll),
      mentionUserIds: draft.mentionUserIds ?? [],
    }),
    is_deleted: false,
    created_at: draft.createdAt ?? new Date().toISOString(),
    profiles: draft.senderProfile,
    optimistic: true,
  };

  return [
    ...existing.filter((msg) => msg.id !== draft.tempId),
    optimisticMessage,
  ];
}

/** Builds structured reminder text and card metadata for a poll or task block. */
export function buildBlockReminderMessage(
  block: ParsedBlock<'poll' | 'task'>,
  tallies?: readonly PollTally[],
): { content: string; metadata: ChatMessageMetadata } {
  let content: string;

  if (block.type === 'poll') {
    let totalVotes = 0;
    for (const tally of tallies ?? []) {
      if (tally.block_id === block.id) {
        totalVotes += tally.vote_count;
      }
    }
    content =
      totalVotes > 0
        ? `「${block.title}」当前已有 ${totalVotes} 票，快来参与投票`
        : `「${block.title}」已发起，快来投出你的第一票`;
  } else {
    const totalCount = block.items.length;
    let unclaimedCount = 0;
    let doneCount = 0;
    for (const item of block.items) {
      if (item.data.status === 'unclaimed') {
        unclaimedCount += 1;
      } else if (item.data.status === 'done') {
        doneCount += 1;
      }
    }
    content =
      unclaimedCount > 0
        ? `「${block.title}」还有 ${unclaimedCount} 项待认领，快来认领分工`
        : `「${block.title}」共 ${totalCount} 项任务，已完成 ${doneCount} 项，记得跟进进度`;
  }

  return {
    content,
    metadata: {
      mentionAll: false,
      mentionUserIds: [],
      linkedBlockId: block.id,
      linkedBlockType: block.type,
      linkedTitle: block.title,
    },
  };
}

/** Extracts a prefilled title (<=60 code points) and details (<=300 for schedule, <=400 for task) from chat text. */
export function buildBlockPrefillFromMessage(
  content: string,
  target: 'task' | 'schedule',
): { title: string; details: string } {
  const maxDetailsLength = target === 'schedule' ? 300 : 400;
  const trimmed = typeof content === 'string' ? content.trim() : '';
  if (!trimmed) {
    return { title: '', details: '' };
  }

  const nonEmptyLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const firstLine = nonEmptyLines[0] ?? '';
  const title = Array.from(firstLine).slice(0, 60).join('');
  const remaining = nonEmptyLines.slice(1).join('\n');
  const details = Array.from(remaining).slice(0, maxDetailsLength).join('');

  return { title, details };
}

/** Returns whether `currentUserId` is targeted by `@all` or direct user mentions in message metadata. */
export function isCurrentUserMentioned(
  metadata: ChatMessageMetadata,
  currentUserId: string | null,
): boolean {
  return (
    metadata.mentionAll ||
    (currentUserId !== null && metadata.mentionUserIds.includes(currentUserId))
  );
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats an ISO timestamp into `HH:mm` (today) or `MM/DD HH:mm` (other days), or `''` if invalid. */
export function formatChatTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return '';
  }

  const date = new Date(ms);
  const now = new Date();
  const time = `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return time;
  }

  return `${padTwo(date.getMonth() + 1)}/${padTwo(date.getDate())} ${time}`;
}
