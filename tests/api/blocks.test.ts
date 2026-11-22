import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseBlockRowsSafely,
  parsePollTalliesSafely,
  validateCommentContent,
  validateCreateBlockInput,
  validateTaskImagesInput,
} from '@/src/api/blockHelpers';
import { RoomApiError } from '@/src/api/roomHelpers';
import {
  getInvalidationKeysForRealtimeEvent,
  isCurrentUserKickedEvent,
} from '@/src/hooks/realtimeHelpers';
import {
  MAX_IMAGE_BYTES,
  MediaUploadError,
  buildCanonicalMediaUrl,
  buildRoomMediaPath,
  extractMediaStoragePath,
  validateImageSizeBytes,
} from '@/src/lib/mediaHelpers';
import type { BlockItemRow, BlockRow } from '@/src/types/database';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mediaHelpers', () => {
  it('builds scoped storage paths and extracts storage path from canonical authenticated URLs', () => {
    const path = buildRoomMediaPath('r1', 'task', 'i1', 'jpg');
    expect(path.startsWith('r1/task/i1/')).toBe(true);
    expect(path.endsWith('.jpg')).toBe(true);

    const canonical = buildCanonicalMediaUrl('https://demo.supabase.co', path);
    expect(canonical).toBe(
      `https://demo.supabase.co/storage/v1/object/authenticated/room-media/${path}`,
    );

    expect(
      extractMediaStoragePath(
        'https://demo.supabase.co/storage/v1/object/authenticated/room-media/r1/task/i1/a.jpg',
      ),
    ).toBe('r1/task/i1/a.jpg');

    expect(
      extractMediaStoragePath(
        'https://demo.supabase.co/storage/v1/object/sign/room-media/r1/expense/e1/receipt.png?token=xyz',
      ),
    ).toBe('r1/expense/e1/receipt.png');

    expect(extractMediaStoragePath('r1/task/i1/a.jpg')).toBe('r1/task/i1/a.jpg');
    expect(
      extractMediaStoragePath(
        'https://demo.supabase.co/storage/v1/object/public/other-bucket/r1/task/i1/a.jpg',
      ),
    ).toBeNull();
    expect(extractMediaStoragePath('https://example.com/photo.jpg')).toBeNull();
    expect(extractMediaStoragePath('')).toBeNull();
    expect(extractMediaStoragePath('invalid-path')).toBeNull();
    expect(
      extractMediaStoragePath(
        'https://demo.supabase.co/storage/v1/object/authenticated/room-media/r1/task/i1/%E0%A4%A.jpg',
      ),
    ).toBeNull();
  });

  it('enforces 5MB max image byte limit and throws IMAGE_TOO_LARGE above threshold', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(() => validateImageSizeBytes(5 * 1024 * 1024)).not.toThrow();
    expect(() => validateImageSizeBytes(1024)).not.toThrow();
    expect(() => validateImageSizeBytes(undefined)).not.toThrow();

    expect(() => validateImageSizeBytes(5 * 1024 * 1024 + 1)).toThrow(
      'IMAGE_TOO_LARGE',
    );

    try {
      validateImageSizeBytes(5 * 1024 * 1024 + 1);
    } catch (err) {
      expect(err).toBeInstanceOf(MediaUploadError);
      expect((err as MediaUploadError).code).toBe('IMAGE_TOO_LARGE');
    }
  });
});

describe('realtimeHelpers', () => {
  it('invalidates both roomBlocks and roomPollTallies on block_items realtime events', () => {
    const keys = getInvalidationKeysForRealtimeEvent('r1', 'block_items');
    expect(keys).toEqual([
      ['room', 'r1', 'blocks'],
      ['room', 'r1', 'pollTallies'],
    ]);
  });

  it('invalidates roomDetail and rooms list on rooms realtime events', () => {
    const keys = getInvalidationKeysForRealtimeEvent('r1', 'rooms');
    expect(keys).toEqual([['room', 'r1'], ['rooms']]);
  });

  it('invalidates appropriate query keys for room_members, blocks, and item_comments', () => {
    expect(getInvalidationKeysForRealtimeEvent('r1', 'room_members')).toEqual([
      ['room', 'r1', 'members'],
      ['rooms'],
    ]);
    expect(getInvalidationKeysForRealtimeEvent('r1', 'blocks')).toEqual([
      ['room', 'r1', 'blocks'],
      ['room', 'r1', 'pollTallies'],
    ]);
    expect(
      getInvalidationKeysForRealtimeEvent('r1', 'item_comments', 'item-99'),
    ).toEqual([['item', 'item-99', 'comments']]);
    expect(getInvalidationKeysForRealtimeEvent('r1', 'item_comments')).toEqual(
      [],
    );
    expect(getInvalidationKeysForRealtimeEvent('r1', 'unknown_table')).toEqual(
      [],
    );
  });

  it('detects when the current user membership row transitions to kicked', () => {
    expect(
      isCurrentUserKickedEvent(
        { user_id: 'u1', status: 'kicked' },
        'u1',
      ),
    ).toBe(true);
    expect(
      isCurrentUserKickedEvent(
        { user_id: 'u2', status: 'kicked' },
        'u1',
      ),
    ).toBe(false);
    expect(
      isCurrentUserKickedEvent(
        { user_id: 'u1', status: 'active' },
        'u1',
      ),
    ).toBe(false);
    expect(isCurrentUserKickedEvent(null, 'u1')).toBe(false);
    expect(
      isCurrentUserKickedEvent({ user_id: 'u1', status: 'kicked' }, null),
    ).toBe(false);
  });
});

describe('blockHelpers', () => {
  const baseBlock = (
    overrides: Partial<BlockRow> & Pick<BlockRow, 'id' | 'type' | 'title' | 'config'>,
  ): BlockRow => ({
    room_id: 'r1',
    sort_order: 0,
    created_by: 'u1',
    created_at: '2026-11-22T10:00:00Z',
    updated_at: '2026-11-22T10:00:00Z',
    ...overrides,
  });

  const baseItem = (
    overrides: Partial<BlockItemRow> & Pick<BlockItemRow, 'id' | 'block_id' | 'data'>,
  ): BlockItemRow => ({
    room_id: 'r1',
    sort_order: 0,
    is_deleted: false,
    created_by: 'u1',
    created_at: '2026-11-22T10:00:00Z',
    updated_at: '2026-11-22T10:00:00Z',
    ...overrides,
  });

  it('validates block configs and item payloads via Zod and safely drops malformed items with console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const blocks: BlockRow[] = [
      baseBlock({
        id: 'b-task',
        type: 'task',
        title: '分工任务',
        sort_order: 2,
        config: { allowMemberCreate: true },
      }),
      baseBlock({
        id: 'b-poll',
        type: 'poll',
        title: '去哪里聚餐',
        sort_order: 1,
        config: { mode: 'option' },
      }),
      baseBlock({
        id: 'b-bad-block',
        type: 'expense',
        title: '坏配置账单',
        sort_order: 0,
        config: { mode: 'invalid-mode' },
      }),
    ];

    const items: BlockItemRow[] = [
      baseItem({
        id: 'i-poll-valid',
        block_id: 'b-poll',
        sort_order: 1,
        data: { label: '潮汕牛肉火锅', voterIds: ['should-strip'] },
      }),
      baseItem({
        id: 'i-poll-bad',
        block_id: 'b-poll',
        sort_order: 0,
        data: { label: '' },
      }),
      baseItem({
        id: 'i-task-valid',
        block_id: 'b-task',
        sort_order: 0,
        data: { title: '带露营灯' },
      }),
      baseItem({
        id: 'i-task-deleted',
        block_id: 'b-task',
        sort_order: 1,
        is_deleted: true,
        data: { title: '已删除任务' },
      }),
      baseItem({
        id: 'i-orphan',
        block_id: 'b-bad-block',
        sort_order: 0,
        data: { title: '孤儿账单' },
      }),
    ];

    const parsed = parseBlockRowsSafely(blocks, items);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.id).toBe('b-poll');
    expect(parsed[1]?.id).toBe('b-task');

    const pollBlock = parsed[0];
    expect(pollBlock?.type).toBe('poll');
    if (pollBlock?.type === 'poll') {
      expect(pollBlock.config.multiple).toBe(false);
      expect(pollBlock.items).toHaveLength(1);
      expect(pollBlock.items[0]?.data).toEqual({ label: '潮汕牛肉火锅' });
      expect('voterIds' in (pollBlock.items[0]?.data ?? {})).toBe(false);
    }

    const taskBlock = parsed[1];
    expect(taskBlock?.type).toBe('task');
    if (taskBlock?.type === 'task') {
      expect(taskBlock.items).toHaveLength(1);
      expect(taskBlock.items[0]?.data.status).toBe('unclaimed');
      expect(taskBlock.items[0]?.data.assigneeIds).toEqual([]);
    }

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('parses poll tallies safely and drops malformed tally rows with console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const tallies = parsePollTalliesSafely([
      {
        item_id: 'i1',
        block_id: 'b1',
        vote_count: 3,
        my_voted: true,
        voter_ids: ['u1', 'u2'],
      },
      {
        item_id: 'i-bad',
        block_id: 'b1',
        vote_count: -1,
        my_voted: false,
        voter_ids: [],
      },
    ]);

    expect(tallies).toHaveLength(1);
    expect(tallies[0]?.item_id).toBe('i1');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('validates block creation, task image limit, and comment input before mutations', () => {
    const validBlock = validateCreateBlockInput({
      roomId: 'r1',
      type: 'expense',
      title: '  露营 AA 分账  ',
      config: { mode: 'split', totalBudget: null, currency: 'CNY' },
    });
    expect(validBlock.title).toBe('露营 AA 分账');

    expect(() =>
      validateCreateBlockInput({
        roomId: 'r1',
        type: 'task',
        title: '   ',
        config: { allowMemberCreate: true },
      }),
    ).toThrow(RoomApiError);

    expect(() =>
      validateTaskImagesInput([
        'https://a.com/1.jpg',
        'https://a.com/2.jpg',
        'https://a.com/3.jpg',
        'https://a.com/4.jpg',
      ]),
    ).toThrow(RoomApiError);

    try {
      validateTaskImagesInput(['1', '2', '3', '4']);
    } catch (err) {
      expect((err as RoomApiError).code).toBe('MAX_IMAGES_EXCEEDED');
    }

    expect(validateCommentContent('  收到，我来带冰块  ')).toBe('收到，我来带冰块');
    expect(() => validateCommentContent('   ')).toThrow(RoomApiError);
  });
});
