import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  ChatMessageMetadataSchema,
  ExpenseConfigSchema,
  ExpenseItemDataSchema,
  PollConfigSchema,
  PollItemDataSchema,
  PollTallySchema,
  ScheduleConfigSchema,
  ScheduleItemDataSchema,
  TaskConfigSchema,
  TaskItemDataSchema,
  parseBlockConfig,
  parseBlockItemData,
  parseChatMessageMetadata,
} from '@/src/schemas/blocks';
import type {
  ActivityAction,
  BlockedUserWithProfile,
  ChatMessageType,
  MessageReportRow,
  RoomChatReadRow,
  RoomMessageRow,
  RoomMessageWithSender,
  UserBlockRow,
} from '@/src/types/database';
import {
  ROOM_CODE_ALPHABET,
  buildInviteLink,
  buildShareMessage,
  extractRoomCodeFromUrl,
  isValidRoomCode,
  normalizeRoomCode,
} from '@/src/lib/roomCode';
import { ROOM_TEMPLATES, TEMPLATE_LIST } from '@/src/lib/templates';

describe('roomCode utilities (Review Focus #1)', () => {
  it('defines the 32-char non-confusable alphabet excluding 0, O, 1, I', () => {
    expect(ROOM_CODE_ALPHABET).toBe('23456789ABCDEFGHJKLMNPQRSTUVWXYZ');
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[0O1I]/);
  });

  it('normalizes whitespace, hyphens, and lowercase cleanly', () => {
    expect(normalizeRoomCode(' k7m-3p9 ')).toBe('K7M3P9');
    expect(normalizeRoomCode('a b-c d-e f')).toBe('ABCDEF');
    expect(isValidRoomCode(' k7m-3p9 ')).toBe(true);
    expect(isValidRoomCode('234567')).toBe(true);
  });

  it('rejects confusable chars (0/O/1/I), wrong lengths, and symbols', () => {
    expect(isValidRoomCode('K7M0P9')).toBe(false);
    expect(isValidRoomCode('K7MOP9')).toBe(false);
    expect(isValidRoomCode('K7M1P9')).toBe(false);
    expect(isValidRoomCode('K7MIP9')).toBe(false);
    expect(isValidRoomCode('K7M3P')).toBe(false);
    expect(isValidRoomCode('K7M3P99')).toBe(false);
    expect(isValidRoomCode('K7M@P9')).toBe(false);
    expect(isValidRoomCode('')).toBe(false);
  });

  it('builds invite links and extracts normalized valid room codes from URLs', () => {
    const link = buildInviteLink('k7m-3p9');
    expect(link).toBe('poproom://room/join?code=K7M3P9');
    expect(extractRoomCodeFromUrl('poproom://room/join?code=k7m3p9')).toBe('K7M3P9');
    expect(extractRoomCodeFromUrl('poproom://room/join?code=k7m-3p9&from=share')).toBe('K7M3P9');
    expect(extractRoomCodeFromUrl('poproom:///room/join?code=k7m3p9')).toBe('K7M3P9');
  });

  it('extracts normalized valid room codes from Expo Go exp:// and exps:// invite links (Important #5)', () => {
    expect(
      extractRoomCodeFromUrl('exp://192.168.1.10:8081/--/room/join?code=K7M3P9'),
    ).toBe('K7M3P9');
    expect(
      extractRoomCodeFromUrl(
        'exp://192.168.1.10:8081/--/room/join?code=k7m-3p9&from=share',
      ),
    ).toBe('K7M3P9');
    expect(
      extractRoomCodeFromUrl('exps://u.expo.dev/update/123/--/room/join?code=234567'),
    ).toBe('234567');
    expect(
      extractRoomCodeFromUrl('exp://192.168.1.10:8081/--/profile?code=K7M3P9'),
    ).toBeNull();
  });

  it('returns null for unrelated URLs or invalid room codes', () => {
    expect(extractRoomCodeFromUrl('poproom://room/join?code=K7M0P9')).toBeNull();
    expect(extractRoomCodeFromUrl('poproom://room/join?code=SHORT')).toBeNull();
    expect(extractRoomCodeFromUrl('poproom://room/join')).toBeNull();
    expect(extractRoomCodeFromUrl('poproom://profile?code=K7M3P9')).toBeNull();
    expect(extractRoomCodeFromUrl('https://example.com/room/join?code=K7M3P9')).toBeNull();
    expect(extractRoomCodeFromUrl('not-a-valid-url')).toBeNull();
  });

  it('builds share messages containing title, normalized code, and invite URL', () => {
    const url = buildInviteLink('K7M3P9');
    const msg = buildShareMessage('周末露营局', 'k7m-3p9', url);
    expect(msg).toContain('周末露营局');
    expect(msg).toContain('K7M3P9');
    expect(msg).toContain(url);
  });
});

describe('Zod block schemas', () => {
  it('validates PollConfigSchema, PollTallySchema, and strips voterIds from PollItemDataSchema', () => {
    const pollConfig = PollConfigSchema.parse({
      mode: 'availability',
      multiple: true,
      anonymous: true,
      allowAddOption: true,
      deadline: null,
      isLocked: false,
      candidateDates: ['2026-11-28'],
      timeSlots: ['morning', 'afternoon'],
    });
    expect(pollConfig.mode).toBe('availability');
    expect(pollConfig.anonymous).toBe(true);

    const parsedItem = PollItemDataSchema.parse({
      label: '周六下午',
      slotDate: '2026-11-28',
      slotPeriod: 'afternoon',
      voterIds: ['user-1', 'user-2'],
    });
    expect(parsedItem).toEqual({
      label: '周六下午',
      slotDate: '2026-11-28',
      slotPeriod: 'afternoon',
    });
    expect('voterIds' in parsedItem).toBe(false);
    expect('voterIds' in PollItemDataSchema.shape).toBe(false);

    const tally = PollTallySchema.parse({
      item_id: 'item-1',
      block_id: 'block-1',
      vote_count: 2,
      my_voted: true,
      voter_ids: [],
    });
    expect(tally.voter_ids).toEqual([]);
  });

  it('enforces max 3 imageUrls on TaskItemDataSchema', () => {
    expect(TaskConfigSchema.parse({ allowMemberCreate: true })).toEqual({
      allowMemberCreate: true,
    });

    const valid = TaskItemDataSchema.safeParse({
      title: '买矿泉水',
      description: '两箱农夫山泉',
      status: 'in_progress',
      assigneeIds: ['user-1'],
      dueAt: null,
      imageUrls: ['https://a.jpg', 'https://b.jpg', 'https://c.jpg'],
    });
    expect(valid.success).toBe(true);

    const tooManyImages = TaskItemDataSchema.safeParse({
      title: '买矿泉水',
      description: '',
      status: 'unclaimed',
      assigneeIds: [],
      dueAt: null,
      imageUrls: ['1.jpg', '2.jpg', '3.jpg', '4.jpg'],
    });
    expect(tooManyImages.success).toBe(false);
  });

  it('accepts plain-text locationName with omitted latitude/longitude on ScheduleItemDataSchema', () => {
    expect(ScheduleConfigSchema.parse({ groupBy: 'day' })).toEqual({
      groupBy: 'day',
    });

    const parsed = ScheduleItemDataSchema.parse({
      groupLabel: 'Day 1',
      startTime: '09:30',
      title: '东门集合',
      locationName: '西湖景区东门停车场',
      ownerId: null,
      notes: '带好防晒',
    });
    expect(parsed.locationName).toBe('西湖景区东门停车场');
    expect(parsed.latitude).toBeUndefined();
    expect(parsed.longitude).toBeUndefined();
  });

  it('rejects amount <= 0 and empty participantIds on ExpenseItemDataSchema', () => {
    expect(
      ExpenseConfigSchema.parse({
        mode: 'split',
        totalBudget: null,
        currency: 'CNY',
      }),
    ).toEqual({
      mode: 'split',
      totalBudget: null,
      currency: 'CNY',
    });

    const zeroAmount = ExpenseItemDataSchema.safeParse({
      title: '午餐',
      amount: 0,
      paidByUserId: 'user-1',
      participantIds: ['user-1'],
      receiptUrl: null,
      spentAt: '2026-11-28T12:00:00Z',
    });
    expect(zeroAmount.success).toBe(false);

    const negativeAmount = ExpenseItemDataSchema.safeParse({
      title: '午餐',
      amount: -25,
      paidByUserId: 'user-1',
      participantIds: ['user-1'],
      receiptUrl: null,
      spentAt: '2026-11-28T12:00:00Z',
    });
    expect(negativeAmount.success).toBe(false);

    const emptyParticipants = ExpenseItemDataSchema.safeParse({
      title: '午餐',
      amount: 120,
      paidByUserId: 'user-1',
      participantIds: [],
      receiptUrl: null,
      spentAt: '2026-11-28T12:00:00Z',
    });
    expect(emptyParticipants.success).toBe(false);

    const valid = ExpenseItemDataSchema.safeParse({
      title: '午餐',
      amount: 120,
      paidByUserId: 'user-1',
      participantIds: ['user-1', 'user-2'],
      receiptUrl: null,
      spentAt: '2026-11-28T12:00:00Z',
    });
    expect(valid.success).toBe(true);
  });

  it('dispatches parseBlockConfig and parseBlockItemData by BlockType', () => {
    const taskCfg = parseBlockConfig('task', { allowMemberCreate: false });
    expect(taskCfg.allowMemberCreate).toBe(false);

    const pollItem = parseBlockItemData('poll', { label: '火锅' });
    expect(pollItem.label).toBe('火锅');
  });

  it('validates ChatMessageMetadataSchema and safely defaults null/undefined/non-object via parseChatMessageMetadata', () => {
    expect(parseChatMessageMetadata(null)).toEqual({
      mentionAll: false,
      mentionUserIds: [],
    });
    expect(parseChatMessageMetadata(undefined)).toEqual({
      mentionAll: false,
      mentionUserIds: [],
    });
    expect(parseChatMessageMetadata('plain-text')).toEqual({
      mentionAll: false,
      mentionUserIds: [],
    });
    expect(parseChatMessageMetadata(123)).toEqual({
      mentionAll: false,
      mentionUserIds: [],
    });

    const parsed = parseChatMessageMetadata({
      mentionAll: true,
      mentionUserIds: ['user-1', 'user-2'],
      linkedBlockId: 'block-1',
      linkedItemId: 'item-1',
      linkedBlockType: 'task',
      linkedTitle: '买矿泉水',
    });
    expect(parsed).toEqual({
      mentionAll: true,
      mentionUserIds: ['user-1', 'user-2'],
      linkedBlockId: 'block-1',
      linkedItemId: 'item-1',
      linkedBlockType: 'task',
      linkedTitle: '买矿泉水',
    });

    expect(
      ChatMessageMetadataSchema.safeParse({ linkedBlockType: 'poll' }).success,
    ).toBe(true);
    expect(() =>
      parseChatMessageMetadata({ linkedBlockType: 'chat' }),
    ).toThrow(ZodError);
    expect(() =>
      parseChatMessageMetadata({ mentionAll: 'yes' }),
    ).toThrow(ZodError);
    expect(() =>
      parseChatMessageMetadata({ mentionUserIds: [''] }),
    ).toThrow(ZodError);

    // Compile-time check for Stage 2 database row types
    const action: ActivityAction = 'delete_message';
    const leaveAction: ActivityAction = 'leave_room';
    const msgType: ChatMessageType = 'block_card';
    const msgRow: RoomMessageRow = {
      id: 'm1',
      room_id: 'r1',
      sender_id: 'u1',
      msg_type: msgType,
      content: 'hi',
      metadata: parsed,
      is_deleted: false,
      created_at: '2026-11-22T00:00:00Z',
    };
    const msgWithSender: RoomMessageWithSender = { ...msgRow, profiles: null };
    const reportRow: MessageReportRow = {
      id: 'rep1',
      message_id: 'm1',
      room_id: 'r1',
      reporter_id: 'u2',
      reason: 'spam',
      created_at: '2026-11-22T00:00:00Z',
    };
    const blockRow: UserBlockRow = {
      blocker_id: 'u2',
      blocked_id: 'u1',
      created_at: '2026-11-22T00:00:00Z',
    };
    const blockedWithProfile: BlockedUserWithProfile = {
      ...blockRow,
      profiles: null,
    };
    const readRow: RoomChatReadRow = {
      room_id: 'r1',
      user_id: 'u1',
      last_read_at: '2026-11-22T00:00:00Z',
    };
    expect([
      action,
      leaveAction,
      msgWithSender.id,
      reportRow.id,
      blockedWithProfile.blocked_id,
      readRow.room_id,
    ]).toHaveLength(6);
  });
});

describe('ROOM_TEMPLATES preset definitions', () => {
  it('exposes all 4 templates in TEMPLATE_LIST with Stage 2 chatEnabled defaults', () => {
    expect(TEMPLATE_LIST.map((t) => t.type)).toEqual([
      'campus',
      'travel',
      'party',
      'custom',
    ]);
    expect(ROOM_TEMPLATES.campus.chatEnabled).toBe(true);
    expect(ROOM_TEMPLATES.travel.chatEnabled).toBe(true);
    expect(ROOM_TEMPLATES.party.chatEnabled).toBe(false);
    expect(ROOM_TEMPLATES.custom.chatEnabled).toBe(false);
    for (const preset of TEMPLATE_LIST) {
      for (const block of preset.blocks) {
        expect(() => parseBlockConfig(block.type, block.config)).not.toThrow();
      }
    }
  });

  it('matches Spec 5.5 block order and modes for campus, travel, party, and custom', () => {
    const campus = ROOM_TEMPLATES.campus;
    expect(campus.blocks).toHaveLength(4);
    expect(campus.blocks.map((b) => b.type)).toEqual([
      'poll',
      'task',
      'schedule',
      'expense',
    ]);
    expect(campus.blocks[0]?.type === 'poll' && campus.blocks[0].config.mode).toBe('availability');
    expect(campus.blocks[3]?.type === 'expense' && campus.blocks[3].config.mode).toBe('budget');

    const travel = ROOM_TEMPLATES.travel;
    expect(travel.blocks).toHaveLength(4);
    expect(travel.blocks.map((b) => b.type)).toEqual([
      'poll',
      'schedule',
      'task',
      'expense',
    ]);
    expect(travel.blocks[0]?.type === 'poll' && travel.blocks[0].config.mode).toBe('option');
    expect(travel.blocks[3]?.type === 'expense' && travel.blocks[3].config.mode).toBe('split');

    const party = ROOM_TEMPLATES.party;
    expect(party.blocks).toHaveLength(2);
    expect(party.blocks.map((b) => b.type)).toEqual(['poll', 'expense']);
    expect(party.blocks[0]?.type === 'poll' && party.blocks[0].config.mode).toBe('option');
    expect(party.blocks[1]?.type === 'expense' && party.blocks[1].config.mode).toBe('split');

    const custom = ROOM_TEMPLATES.custom;
    expect(custom.blocks).toHaveLength(0);
  });
});
