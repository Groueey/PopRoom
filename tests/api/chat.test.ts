import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('@/src/lib/supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

import {
  blockUser,
  fetchMyBlockedUsers,
  fetchRoomChatRead,
  fetchRoomMessages,
  markRoomChatRead,
  reportRoomMessage,
  sendRoomMessage,
  softDeleteRoomMessage,
  unblockUser,
} from '@/src/api/chat';
import { RoomApiError } from '@/src/api/roomHelpers';
import { QUERY_KEYS } from '@/src/lib/queryClient';

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

describe('QUERY_KEYS Stage 2 additions', () => {
  it('builds deterministic query keys for roomMessages, roomChatRead, and userBlocks', () => {
    expect(QUERY_KEYS.roomMessages('r1')).toEqual(['room', 'r1', 'messages']);
    expect(QUERY_KEYS.roomChatRead('r1')).toEqual(['room', 'r1', 'chatRead']);
    expect(QUERY_KEYS.roomChatRead('r1', 'u1')).toEqual([
      'room',
      'r1',
      'chatRead',
      'u1',
    ]);
    expect(QUERY_KEYS.userBlocks()).toEqual(['userBlocks']);
    expect(QUERY_KEYS.userBlocks('u1')).toEqual(['userBlocks', 'u1']);
  });
});

describe('chat API layer', () => {
  it('fetchRoomMessages queries room_messages with profile join, normalizes array/object profiles, and parses metadata', async () => {
    const mockLimit = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'm2',
          room_id: 'r1',
          sender_id: 'u2',
          msg_type: 'text',
          content: '第二条',
          metadata: { mentionAll: true },
          is_deleted: false,
          created_at: '2026-11-22T10:02:00.000Z',
          profiles: [
            {
              id: 'u2',
              nickname: '小红',
              avatar_color: '#4ECDC4',
              avatar_url: null,
            },
          ],
        },
        {
          id: 'm1',
          room_id: 'r1',
          sender_id: 'u1',
          msg_type: 'text',
          content: '第一条',
          metadata: null,
          is_deleted: false,
          created_at: '2026-11-22T10:00:00.000Z',
          profiles: {
            id: 'u1',
            nickname: '小明',
            avatar_color: '#FF6B6B',
            avatar_url: null,
          },
        },
      ],
      error: null,
    });
    const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockEqDeleted = vi.fn().mockReturnValue({ order: mockOrder });
    const mockEqRoom = vi.fn().mockReturnValue({ eq: mockEqDeleted });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEqRoom });
    mockFrom.mockReturnValue({ select: mockSelect });

    const messages = await fetchRoomMessages('r1');

    expect(mockFrom).toHaveBeenCalledWith('room_messages');
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('profiles(id, nickname, avatar_color, avatar_url)'),
    );
    expect(mockEqRoom).toHaveBeenCalledWith('room_id', 'r1');
    expect(mockEqDeleted).toHaveBeenCalledWith('is_deleted', false);
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(mockLimit).toHaveBeenCalledWith(200);
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(messages[0]?.metadata).toEqual({
      mentionAll: false,
      mentionUserIds: [],
    });
    expect(messages[1]?.profiles?.nickname).toBe('小红');
    expect(messages[1]?.metadata.mentionAll).toBe(true);
  });

  it('sendRoomMessage validates input, parses metadata, calls RPC, and maps CHAT_DISABLED', async () => {
    await expect(
      sendRoomMessage({ roomId: 'r1', content: '   ' }),
    ).rejects.toThrow(RoomApiError);

    mockRpc.mockResolvedValueOnce({
      data: {
        id: 'm10',
        room_id: 'r1',
        sender_id: 'u1',
        msg_type: 'text',
        content: '你好',
        metadata: { mentionAll: false, mentionUserIds: ['u2'] },
        is_deleted: false,
        created_at: '2026-11-22T10:05:00.000Z',
      },
      error: null,
    });

    const sent = await sendRoomMessage({
      roomId: 'r1',
      content: '  你好  ',
      metadata: { mentionUserIds: ['u2'] },
    });

    expect(mockRpc).toHaveBeenCalledWith('send_room_message', {
      p_room_id: 'r1',
      p_msg_type: 'text',
      p_content: '你好',
      p_metadata: { mentionAll: false, mentionUserIds: ['u2'] },
    });
    expect(sent.id).toBe('m10');
    expect(sent.metadata).toEqual({
      mentionAll: false,
      mentionUserIds: ['u2'],
    });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'CHAT_DISABLED' },
    });

    try {
      await sendRoomMessage({ roomId: 'r1', content: 'hi' });
      expect.unreachable('should map CHAT_DISABLED');
    } catch (err) {
      expect(err).toBeInstanceOf(RoomApiError);
      expect((err as RoomApiError).code).toBe('CHAT_DISABLED');
    }
  });

  it('softDeleteRoomMessage and reportRoomMessage validate inputs and invoke RPCs', async () => {
    mockRpc.mockResolvedValueOnce({ data: { id: 'm1' }, error: null });
    await softDeleteRoomMessage('m1');
    expect(mockRpc).toHaveBeenCalledWith('soft_delete_room_message', {
      p_message_id: 'm1',
    });

    await expect(reportRoomMessage('m1', '   ')).rejects.toThrow(RoomApiError);

    mockRpc.mockResolvedValueOnce({ data: { id: 'rep-1' }, error: null });
    await reportRoomMessage('m1', '  垃圾广告  ');
    expect(mockRpc).toHaveBeenCalledWith('report_room_message', {
      p_message_id: 'm1',
      p_reason: '垃圾广告',
    });
  });

  it('fetchMyBlockedUsers uses user_blocks_blocked_id_fkey join and normalizes profiles', async () => {
    const mockOrder = vi.fn().mockResolvedValue({
      data: [
        {
          blocker_id: 'u1',
          blocked_id: 'u2',
          created_at: '2026-11-22T09:00:00.000Z',
          profiles: {
            id: 'u2',
            nickname: '广告号',
            avatar_color: '#64748B',
            avatar_url: null,
          },
        },
      ],
      error: null,
    });
    const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ select: mockSelect });

    const blocked = await fetchMyBlockedUsers('u1');

    expect(mockFrom).toHaveBeenCalledWith('user_blocks');
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('user_blocks_blocked_id_fkey'),
    );
    expect(mockEq).toHaveBeenCalledWith('blocker_id', 'u1');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.profiles?.nickname).toBe('广告号');
  });

  it('blockUser rejects self-blocking with CANNOT_BLOCK_SELF and upserts otherwise; unblockUser deletes', async () => {
    try {
      await blockUser('u1', 'u1');
      expect.unreachable('should reject blocking self');
    } catch (err) {
      expect(err).toBeInstanceOf(RoomApiError);
      expect((err as RoomApiError).code).toBe('CANNOT_BLOCK_SELF');
    }

    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValueOnce({ upsert: mockUpsert });
    await blockUser('u1', 'u2');
    expect(mockFrom).toHaveBeenCalledWith('user_blocks');
    expect(mockUpsert).toHaveBeenCalledWith(
      { blocker_id: 'u1', blocked_id: 'u2' },
      { onConflict: 'blocker_id,blocked_id' },
    );

    const mockEqBlocked = vi.fn().mockResolvedValue({ error: null });
    const mockEqBlocker = vi.fn().mockReturnValue({ eq: mockEqBlocked });
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEqBlocker });
    mockFrom.mockReturnValueOnce({ delete: mockDelete });
    await unblockUser('u1', 'u2');
    expect(mockFrom).toHaveBeenCalledWith('user_blocks');
    expect(mockEqBlocker).toHaveBeenCalledWith('blocker_id', 'u1');
    expect(mockEqBlocked).toHaveBeenCalledWith('blocked_id', 'u2');
  });

  it('fetchRoomChatRead and markRoomChatRead query and upsert room_chat_reads', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({
      data: { last_read_at: '2026-11-22T10:00:00.000Z' },
      error: null,
    });
    const mockEqUser = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockEqRoom = vi.fn().mockReturnValue({ eq: mockEqUser });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEqRoom });
    mockFrom.mockReturnValueOnce({ select: mockSelect });

    const cursor = await fetchRoomChatRead('r1', 'u1');
    expect(mockFrom).toHaveBeenCalledWith('room_chat_reads');
    expect(cursor).toBe('2026-11-22T10:00:00.000Z');

    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValueOnce({ upsert: mockUpsert });
    const updatedCursor = await markRoomChatRead('r1', 'u1');
    expect(mockFrom).toHaveBeenCalledWith('room_chat_reads');
    expect(mockUpsert).toHaveBeenCalledWith(
      {
        room_id: 'r1',
        user_id: 'u1',
        last_read_at: updatedCursor,
      },
      { onConflict: 'room_id,user_id' },
    );
    expect(Number.isNaN(Date.parse(updatedCursor))).toBe(false);
  });
});
