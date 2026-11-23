import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParsedBlock } from '@/src/api/blockHelpers';
import { RoomApiError } from '@/src/api/roomHelpers';
import { getInvalidationKeysForRealtimeEvent } from '@/src/hooks/realtimeHelpers';
import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_REPORT_REASON_LENGTH,
  type ParsedRoomMessage,
  REPORT_REASON_PRESETS,
  appendOptimisticChatMessage,
  buildBlockPrefillFromMessage,
  buildBlockReminderMessage,
  countUnreadChatMessages,
  filterVisibleChatMessages,
  formatChatTimestamp,
  isCurrentUserMentioned,
  parseChatMessagesSafely,
  validateChatMessageInput,
  validateReportReasonInput,
} from '@/src/lib/chatHelpers';
import type { PollTally } from '@/src/schemas/blocks';
import type { RoomMessageWithSender } from '@/src/types/database';

afterEach(() => {
  vi.useRealTimers();
});

function makeRawMessage(
  overrides: Partial<RoomMessageWithSender> = {},
): RoomMessageWithSender {
  return {
    id: 'msg-1',
    room_id: 'room-1',
    sender_id: 'user-1',
    msg_type: 'text',
    content: '大家好',
    metadata: {},
    is_deleted: false,
    created_at: '2026-11-22T10:00:00.000Z',
    profiles: {
      id: 'user-1',
      nickname: '小明',
      avatar_color: '#FF6B6B',
      avatar_url: null,
    },
    ...overrides,
  };
}

function makeParsedMessage(
  overrides: Partial<ParsedRoomMessage> = {},
): ParsedRoomMessage {
  return {
    id: 'msg-1',
    room_id: 'room-1',
    sender_id: 'user-1',
    msg_type: 'text',
    content: '大家好',
    metadata: {
      mentionAll: false,
      mentionUserIds: [],
    },
    is_deleted: false,
    created_at: '2026-11-22T10:00:00.000Z',
    profiles: {
      id: 'user-1',
      nickname: '小明',
      avatar_color: '#FF6B6B',
      avatar_url: null,
    },
    ...overrides,
  };
}

describe('chatHelpers constants and input validation', () => {
  it('exposes Stage 2 length limits and Chinese report reason presets', () => {
    expect(MAX_CHAT_MESSAGE_LENGTH).toBe(1000);
    expect(MAX_REPORT_REASON_LENGTH).toBe(300);
    expect(REPORT_REASON_PRESETS).toEqual([
      '垃圾广告或刷屏',
      '不友善或人身攻击',
      '违法违规或敏感内容',
      '其他原因',
    ]);
  });

  it('validates and trims chat messages up to 1000 Unicode code points', () => {
    expect(validateChatMessageInput('  今晚 7 点集合  ')).toBe('今晚 7 点集合');

    const exact1000 = '😀'.repeat(MAX_CHAT_MESSAGE_LENGTH);
    expect(validateChatMessageInput(exact1000)).toBe(exact1000);

    expect(() => validateChatMessageInput('   ')).toThrow(RoomApiError);
    try {
      validateChatMessageInput('');
    } catch (err) {
      expect(err).toBeInstanceOf(RoomApiError);
      expect((err as RoomApiError).code).toBe('INVALID_INPUT');
    }

    const over1000 = '😀'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1);
    try {
      validateChatMessageInput(over1000);
      expect.unreachable('should throw for >1000 chars');
    } catch (err) {
      expect(err).toBeInstanceOf(RoomApiError);
      expect((err as RoomApiError).code).toBe('INVALID_INPUT');
    }
  });

  it('validates and trims report reasons up to 300 Unicode code points', () => {
    expect(validateReportReasonInput('  恶意刷屏  ')).toBe('恶意刷屏');

    const exact300 = '字'.repeat(MAX_REPORT_REASON_LENGTH);
    expect(validateReportReasonInput(exact300)).toBe(exact300);

    try {
      validateReportReasonInput(' \n\t ');
      expect.unreachable('should throw for empty report reason');
    } catch (err) {
      expect(err).toBeInstanceOf(RoomApiError);
      expect((err as RoomApiError).code).toBe('INVALID_INPUT');
    }

    const over300 = '😀'.repeat(MAX_REPORT_REASON_LENGTH + 1);
    try {
      validateReportReasonInput(over300);
      expect.unreachable('should throw for >300 chars');
    } catch (err) {
      expect(err).toBeInstanceOf(RoomApiError);
      expect((err as RoomApiError).code).toBe('INVALID_INPUT');
    }
  });
});

describe('parseChatMessagesSafely', () => {
  it('parses metadata via parseChatMessageMetadata, falls back safely on malformed metadata, and sorts ascending by created_at', () => {
    const newer = makeRawMessage({
      id: 'msg-2',
      created_at: '2026-11-22T10:05:00.000Z',
      metadata: { mentionAll: true, mentionUserIds: ['u2'] },
    });
    const olderMalformed = makeRawMessage({
      id: 'msg-1',
      created_at: '2026-11-22T10:00:00.000Z',
      metadata: { mentionAll: 'not-a-bool', mentionUserIds: [123] },
    });
    const input = [newer, olderMalformed];

    const parsed = parseChatMessagesSafely(input);

    expect(parsed.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
    expect(parsed[0]?.metadata).toEqual({
      mentionAll: false,
      mentionUserIds: [],
    });
    expect(parsed[1]?.metadata).toEqual({
      mentionAll: true,
      mentionUserIds: ['u2'],
    });
    // Does not mutate input array
    expect(input.map((m) => m.id)).toEqual(['msg-2', 'msg-1']);
  });
});

describe('filterVisibleChatMessages & countUnreadChatMessages (Review Focus #1 & #5)', () => {
  it('drops soft-deleted messages and messages from blocked users', () => {
    const visible = makeParsedMessage({ id: 'm1', sender_id: 'u2' });
    const deleted = makeParsedMessage({
      id: 'm2',
      sender_id: 'u3',
      is_deleted: true,
    });
    const fromBlocked = makeParsedMessage({ id: 'm3', sender_id: 'u-blocked' });

    const result = filterVisibleChatMessages(
      [visible, deleted, fromBlocked],
      new Set(['u-blocked']),
    );
    expect(result.map((m) => m.id)).toEqual(['m1']);
  });

  it('never counts self-authored, deleted, or blocked-user messages in unread count', () => {
    const messages: ParsedRoomMessage[] = [
      makeParsedMessage({
        id: 'self',
        sender_id: 'me',
        created_at: '2026-11-22T10:10:00.000Z',
      }),
      makeParsedMessage({
        id: 'deleted',
        sender_id: 'other-1',
        is_deleted: true,
        created_at: '2026-11-22T10:10:00.000Z',
      }),
      makeParsedMessage({
        id: 'blocked',
        sender_id: 'blocked-user',
        created_at: '2026-11-22T10:10:00.000Z',
      }),
      makeParsedMessage({
        id: 'old-read',
        sender_id: 'other-1',
        created_at: '2026-11-22T09:59:00.000Z',
      }),
      makeParsedMessage({
        id: 'at-cursor',
        sender_id: 'other-1',
        created_at: '2026-11-22T10:00:00.000Z',
      }),
      makeParsedMessage({
        id: 'unread-1',
        sender_id: 'other-2',
        created_at: '2026-11-22T10:01:00.000Z',
      }),
      makeParsedMessage({
        id: 'unread-2',
        sender_id: 'other-3',
        created_at: '2026-11-22T10:02:00.000Z',
      }),
    ];
    const blocked = new Set(['blocked-user']);

    expect(
      countUnreadChatMessages(
        messages,
        '2026-11-22T10:00:00.000Z',
        'me',
        blocked,
      ),
    ).toBe(2);

    // When lastReadAt is null or unparseable, counts all visible non-self messages
    expect(countUnreadChatMessages(messages, null, 'me', blocked)).toBe(4);
    expect(
      countUnreadChatMessages(messages, 'invalid-iso-date', 'me', blocked),
    ).toBe(4);

    // When currentUserId is null, still filters deleted/blocked and applies lastReadAt
    expect(
      countUnreadChatMessages(
        messages,
        '2026-11-22T10:00:00.000Z',
        null,
        blocked,
      ),
    ).toBe(3);
  });
});

describe('appendOptimisticChatMessage', () => {
  it('appends an optimistic message without mutating existing array', () => {
    const existing = [makeParsedMessage({ id: 'm1' })];
    const next = appendOptimisticChatMessage(existing, {
      tempId: 'temp-1',
      roomId: 'room-1',
      senderId: 'me',
      senderProfile: {
        id: 'me',
        nickname: '我',
        avatar_color: '#10B981',
        avatar_url: null,
      },
      content: '马上到',
      mentionAll: false,
      mentionUserIds: ['u2'],
      createdAt: '2026-11-22T10:15:00.000Z',
    });

    expect(existing).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      id: 'temp-1',
      room_id: 'room-1',
      sender_id: 'me',
      msg_type: 'text',
      content: '马上到',
      metadata: {
        mentionAll: false,
        mentionUserIds: ['u2'],
      },
      is_deleted: false,
      created_at: '2026-11-22T10:15:00.000Z',
      profiles: {
        id: 'me',
        nickname: '我',
        avatar_color: '#10B981',
        avatar_url: null,
      },
      optimistic: true,
    });
  });
});

describe('buildBlockReminderMessage', () => {
  it('formats poll reminder for zero votes and nonzero tallies', () => {
    const pollBlock: ParsedBlock<'poll'> = {
      id: 'poll-1',
      room_id: 'room-1',
      type: 'poll',
      title: '聚餐地点投票',
      sort_order: 0,
      config: {
        mode: 'option',
        multiple: false,
        anonymous: false,
        allowAddOption: true,
        deadline: null,
        isLocked: false,
      },
      items: [],
      created_by: 'u1',
      created_at: '2026-11-22T09:00:00.000Z',
      updated_at: '2026-11-22T09:00:00.000Z',
    };

    expect(buildBlockReminderMessage(pollBlock)).toEqual({
      content: '「聚餐地点投票」已发起，快来投出你的第一票',
      metadata: {
        mentionAll: false,
        mentionUserIds: [],
        linkedBlockId: 'poll-1',
        linkedBlockType: 'poll',
        linkedTitle: '聚餐地点投票',
      },
    });

    const tallies: PollTally[] = [
      {
        item_id: 'i1',
        block_id: 'poll-1',
        vote_count: 3,
        my_voted: true,
        voter_ids: ['u1'],
      },
      {
        item_id: 'i2',
        block_id: 'poll-1',
        vote_count: 2,
        my_voted: false,
        voter_ids: ['u2'],
      },
      {
        item_id: 'i3',
        block_id: 'other-poll',
        vote_count: 99,
        my_voted: false,
        voter_ids: [],
      },
    ];

    expect(buildBlockReminderMessage(pollBlock, tallies)).toEqual({
      content: '「聚餐地点投票」当前已有 5 票，快来参与投票',
      metadata: {
        mentionAll: false,
        mentionUserIds: [],
        linkedBlockId: 'poll-1',
        linkedBlockType: 'poll',
        linkedTitle: '聚餐地点投票',
      },
    });
  });

  it('formats task reminder for unclaimed items vs all claimed', () => {
    const baseTaskBlock: ParsedBlock<'task'> = {
      id: 'task-1',
      room_id: 'room-1',
      type: 'task',
      title: '露营物资分工',
      sort_order: 1,
      config: { allowMemberCreate: true },
      items: [
        {
          id: 'ti-1',
          block_id: 'task-1',
          room_id: 'room-1',
          type: 'task',
          data: {
            title: '带帐篷',
            description: '',
            status: 'unclaimed',
            assigneeIds: [],
            dueAt: null,
            imageUrls: [],
          },
          sort_order: 0,
          is_deleted: false,
          created_by: 'u1',
          created_at: '2026-11-22T09:00:00.000Z',
          updated_at: '2026-11-22T09:00:00.000Z',
        },
        {
          id: 'ti-2',
          block_id: 'task-1',
          room_id: 'room-1',
          type: 'task',
          data: {
            title: '带矿泉水',
            description: '',
            status: 'done',
            assigneeIds: ['u2'],
            dueAt: null,
            imageUrls: [],
          },
          sort_order: 1,
          is_deleted: false,
          created_by: 'u1',
          created_at: '2026-11-22T09:00:00.000Z',
          updated_at: '2026-11-22T09:00:00.000Z',
        },
      ],
      created_by: 'u1',
      created_at: '2026-11-22T09:00:00.000Z',
      updated_at: '2026-11-22T09:00:00.000Z',
    };

    expect(buildBlockReminderMessage(baseTaskBlock)).toEqual({
      content: '「露营物资分工」还有 1 项待认领，快来认领分工',
      metadata: {
        mentionAll: false,
        mentionUserIds: [],
        linkedBlockId: 'task-1',
        linkedBlockType: 'task',
        linkedTitle: '露营物资分工',
      },
    });

    const allClaimedBlock: ParsedBlock<'task'> = {
      ...baseTaskBlock,
      items: [
        {
          ...baseTaskBlock.items[0]!,
          data: {
            ...baseTaskBlock.items[0]!.data,
            status: 'in_progress',
            assigneeIds: ['u1'],
          },
        },
        baseTaskBlock.items[1]!,
      ],
    };

    expect(buildBlockReminderMessage(allClaimedBlock).content).toBe(
      '「露营物资分工」共 2 项任务，已完成 1 项，记得跟进进度',
    );
  });
});

describe('buildBlockPrefillFromMessage, isCurrentUserMentioned & formatChatTimestamp', () => {
  it('extracts title (<=60 code points) and details (<=400 code points) from multiline chat messages', () => {
    const longTitle = '😀'.repeat(65);
    const longBody = '好'.repeat(450);
    const result = buildBlockPrefillFromMessage(
      `\r\n  ${longTitle}  \r\n\n  第二行说明  \r\n  ${longBody}  \n`,
      'task',
    );

    expect(Array.from(result.title)).toHaveLength(60);
    expect(result.title).toBe('😀'.repeat(60));
    expect(result.details.startsWith('第二行说明\n')).toBe(true);
    expect(Array.from(result.details)).toHaveLength(400);

    const scheduleResult = buildBlockPrefillFromMessage(
      `${longTitle}\n${'😀'.repeat(350)}`,
      'schedule',
    );
    expect(Array.from(scheduleResult.title)).toHaveLength(60);
    expect(Array.from(scheduleResult.details)).toHaveLength(300);
    expect(scheduleResult.details).toBe('😀'.repeat(300));

    expect(buildBlockPrefillFromMessage('  买两箱水  ', 'schedule')).toEqual({
      title: '买两箱水',
      details: '',
    });
    expect(buildBlockPrefillFromMessage('   \n  ', 'task')).toEqual({
      title: '',
      details: '',
    });
  });

  it('checks mentionAll and mentionUserIds accurately', () => {
    expect(
      isCurrentUserMentioned(
        { mentionAll: true, mentionUserIds: [] },
        null,
      ),
    ).toBe(true);
    expect(
      isCurrentUserMentioned(
        { mentionAll: false, mentionUserIds: ['u1'] },
        'u1',
      ),
    ).toBe(true);
    expect(
      isCurrentUserMentioned(
        { mentionAll: false, mentionUserIds: ['u1'] },
        'u2',
      ),
    ).toBe(false);
    expect(
      isCurrentUserMentioned(
        { mentionAll: false, mentionUserIds: ['u1'] },
        null,
      ),
    ).toBe(false);
  });

  it('formats same-day as HH:mm, other-day as MM/DD HH:mm, and invalid as empty string', () => {
    vi.useFakeTimers();
    const nowLocal = new Date(2026, 10, 22, 15, 30, 0);
    vi.setSystemTime(nowLocal);

    const sameDayLocal = new Date(2026, 10, 22, 9, 5, 0).toISOString();
    const earlierDayLocal = new Date(2026, 10, 20, 18, 45, 0).toISOString();

    expect(formatChatTimestamp(sameDayLocal)).toBe('09:05');
    expect(formatChatTimestamp(earlierDayLocal)).toBe('11/20 18:45');
    expect(formatChatTimestamp('not-a-timestamp')).toBe('');
  });

  it('invalidates roomMessages on room_messages realtime event', () => {
    expect(getInvalidationKeysForRealtimeEvent('r1', 'room_messages')).toEqual([
      ['room', 'r1', 'messages'],
    ]);
  });
});
