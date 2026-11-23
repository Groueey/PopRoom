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

import {
  createRoomWithTemplate,
  leaveRoom,
  updateRoomMetadata,
} from '@/src/api/rooms';
import {
  MAX_ROOM_TITLE_LENGTH,
  RoomApiError,
  detectRoomErrorCode,
  mapRoomError,
  prepareJoinPayload,
  validateCreateRoomInput,
  validateUpdateRoomMetadataInput,
} from '@/src/api/roomHelpers';
import type { JoinMode, TemplateType } from '@/src/types/database';

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

describe('mapRoomError', () => {
  it('maps Postgres/Supabase domain errors to crisp Chinese user-facing messages', () => {
    expect(mapRoomError(new Error('ROOM_NOT_FOUND'))).toContain('房间不存在');
    expect(
      mapRoomError({
        code: 'P0001',
        message: 'ERROR: ROOM_ARCHIVED: cannot mutate archived room',
      }),
    ).toContain('归档');
    expect(mapRoomError({ message: 'USER_KICKED' })).toContain('移出');
    expect(mapRoomError(new Error('FORBIDDEN'))).toContain('权限');
    expect(mapRoomError(new Error('INVALID_INPUT'))).toContain('输入');
    expect(mapRoomError(new RoomApiError('INVALID_ROOM_CODE'))).toContain('6 位房间码');
    expect(mapRoomError(new Error('NOT_AUTHENTICATED'))).toContain('登录');
    expect(mapRoomError(new Error('PROFILE_REQUIRED'))).toContain('昵称');
    expect(mapRoomError(new Error('NOT_A_MEMBER'))).toContain('成员');
    expect(mapRoomError(new Error('CHAT_DISABLED'))).toBe('该房间未开启聊天室');
    expect(mapRoomError({ message: 'HOST_CANNOT_LEAVE' })).toBe(
      '房主无法直接退出房间，你可以选择归档活动',
    );
    expect(
      mapRoomError({ code: 'P0001', message: 'ERROR: CANNOT_BLOCK_SELF' }),
    ).toBe('不能屏蔽自己');
    expect(mapRoomError(new RoomApiError('CHAT_DISABLED'))).toBe(
      '该房间未开启聊天室',
    );
    expect(mapRoomError(new RoomApiError('HOST_CANNOT_LEAVE'))).toBe(
      '房主无法直接退出房间，你可以选择归档活动',
    );
    expect(mapRoomError(new RoomApiError('CANNOT_BLOCK_SELF'))).toBe(
      '不能屏蔽自己',
    );
    expect(
      detectRoomErrorCode({
        code: 'PGRST202',
        message:
          'Could not find the function public.create_room_with_template(p_chat_enabled) in the schema cache',
      }),
    ).toBe('SCHEMA_OUTDATED');
    expect(mapRoomError({ code: 'PGRST202' })).toContain('004 / 005');
    expect(detectRoomErrorCode({ code: '42P01', message: 'relation "room_messages" does not exist' })).toBe(
      'SCHEMA_OUTDATED',
    );
  });

  it('preserves custom validation messages on RoomApiError(INVALID_INPUT) and falls back cleanly on unknown errors', () => {
    const customErr = new RoomApiError('INVALID_INPUT', '房间名称不能超过 40 个字');
    expect(mapRoomError(customErr)).toBe('房间名称不能超过 40 个字');

    expect(mapRoomError(null)).toBe('操作失败，请稍后重试');
    expect(mapRoomError({ message: 'unexpected internal panic' })).toBe(
      '操作失败，请稍后重试',
    );
    expect(mapRoomError(new Error('Network request failed'))).toContain('网络');
  });
});

describe('validateCreateRoomInput', () => {
  it('trims title and announcement and returns validated payload', () => {
    const validated = validateCreateRoomInput({
      title: '  周末露营活动  ',
      templateType: 'travel',
      joinMode: 'approval',
      announcement: '  请带上防晒和帐篷  ',
      eventStartAt: '2026-11-28 09:00',
      eventEndAt: '2026-11-29 18:00',
    });

    expect(validated.title).toBe('周末露营活动');
    expect(validated.templateType).toBe('travel');
    expect(validated.joinMode).toBe('approval');
    expect(validated.announcement).toBe('请带上防晒和帐篷');
    expect(validated.eventStartAt).not.toBeNull();
    expect(validated.eventEndAt).not.toBeNull();
    expect(validated.chatEnabled).toBeUndefined();

    expect(
      validateCreateRoomInput({
        title: '社团纳新',
        templateType: 'campus',
        joinMode: 'passcode',
        chatEnabled: true,
      }).chatEnabled,
    ).toBe(true);

    expect(
      validateCreateRoomInput({
        title: '社团纳新',
        templateType: 'campus',
        joinMode: 'passcode',
        chatEnabled: false,
      }).chatEnabled,
    ).toBe(false);
  });

  it('rejects empty title and title exceeding 40 characters', () => {
    expect(() =>
      validateCreateRoomInput({
        title: '   ',
        templateType: 'campus',
        joinMode: 'passcode',
      }),
    ).toThrow(RoomApiError);

    const exact40 = '一'.repeat(MAX_ROOM_TITLE_LENGTH);
    expect(
      validateCreateRoomInput({
        title: exact40,
        templateType: 'party',
        joinMode: 'passcode',
      }).title,
    ).toBe(exact40);

    const over40 = '一'.repeat(MAX_ROOM_TITLE_LENGTH + 1);
    expect(() =>
      validateCreateRoomInput({
        title: over40,
        templateType: 'custom',
        joinMode: 'passcode',
      }),
    ).toThrow(RoomApiError);
  });

  it('rejects invalid templateType, joinMode, and reversed date range', () => {
    expect(() =>
      validateCreateRoomInput({
        title: '聚餐局',
        templateType: 'invalid' as TemplateType,
        joinMode: 'passcode',
      }),
    ).toThrow(RoomApiError);

    expect(() =>
      validateCreateRoomInput({
        title: '聚餐局',
        templateType: 'party',
        joinMode: 'open' as JoinMode,
      }),
    ).toThrow(RoomApiError);

    expect(() =>
      validateCreateRoomInput({
        title: '聚餐局',
        templateType: 'party',
        joinMode: 'passcode',
        eventStartAt: '2026-11-29T18:00:00Z',
        eventEndAt: '2026-11-28T09:00:00Z',
      }),
    ).toThrow(RoomApiError);
  });
});

describe('prepareJoinPayload', () => {
  it('normalizes room code and trims apply_note cleanly', () => {
    expect(prepareJoinPayload(' k7m-3p9 ', '  小明  ')).toEqual({
      p_room_code: 'K7M3P9',
      p_apply_note: '小明',
    });

    expect(prepareJoinPayload('234567', '   ')).toEqual({
      p_room_code: '234567',
      p_apply_note: null,
    });

    expect(prepareJoinPayload('k7m3p9')).toEqual({
      p_room_code: 'K7M3P9',
      p_apply_note: null,
    });
  });

  it('throws INVALID_ROOM_CODE for confusable or invalid codes', () => {
    expect(() => prepareJoinPayload('000000')).toThrow(/INVALID_ROOM_CODE/);
    expect(() => prepareJoinPayload('K7M0P9')).toThrow(RoomApiError);
    expect(() => prepareJoinPayload('K7M1P9')).toThrow(/INVALID_ROOM_CODE/);
    expect(() => prepareJoinPayload('ABC')).toThrow(/INVALID_ROOM_CODE/);
    expect(() => prepareJoinPayload('')).toThrow(/INVALID_ROOM_CODE/);

    try {
      prepareJoinPayload('000000');
    } catch (err) {
      expect(err).toBeInstanceOf(RoomApiError);
      expect((err as RoomApiError).code).toBe('INVALID_ROOM_CODE');
    }
  });
});

describe('validateUpdateRoomMetadataInput', () => {
  it('validates partial room metadata updates cleanly including chat_enabled and event timestamps', () => {
    const patch = validateUpdateRoomMetadataInput({
      title: '  新标题  ',
      announcement: '  周日出发  ',
      join_mode: 'approval',
      allow_member_create_poll: false,
      chat_enabled: true,
      event_start_at: '2026-11-28 09:00',
      event_end_at: '2026-11-29T18:00:00.000Z',
    });

    expect(patch).toEqual({
      title: '新标题',
      announcement: '周日出发',
      join_mode: 'approval',
      allow_member_create_poll: false,
      chat_enabled: true,
      event_start_at: expect.any(String),
      event_end_at: '2026-11-29T18:00:00.000Z',
    });

    expect(
      validateUpdateRoomMetadataInput({
        chat_enabled: false,
        event_start_at: null,
        event_end_at: null,
      }),
    ).toEqual({
      chat_enabled: false,
      event_start_at: null,
      event_end_at: null,
    });

    expect(() => validateUpdateRoomMetadataInput({ title: '  ' })).toThrow(
      RoomApiError,
    );

    expect(() =>
      validateUpdateRoomMetadataInput({ event_start_at: 'not-a-date' }),
    ).toThrow(RoomApiError);

    expect(() =>
      validateUpdateRoomMetadataInput({
        event_start_at: '2026-11-29T18:00:00Z',
        event_end_at: '2026-11-28T09:00:00Z',
      }),
    ).toThrow(
      new RoomApiError('INVALID_INPUT', '活动结束时间不能早于开始时间'),
    );
  });
});

describe('Stage 2 room API mutations', () => {
  it('createRoomWithTemplate forwards p_chat_enabled (boolean or null) to create_room_with_template RPC', async () => {
    const fakeRoom = {
      id: 'room-1',
      title: '周末露营',
      announcement: '',
      template_type: 'travel',
      event_start_at: null,
      event_end_at: null,
      join_mode: 'passcode',
      room_code: 'K7M3P9',
      chat_enabled: false,
      allow_member_create_poll: true,
      status: 'active',
      archived_at: null,
      created_by: 'u1',
      created_at: '2026-11-22T10:00:00.000Z',
      updated_at: '2026-11-22T10:00:00.000Z',
    };
    mockRpc.mockResolvedValue({ data: fakeRoom, error: null });

    await createRoomWithTemplate({
      title: '周末露营',
      templateType: 'travel',
      joinMode: 'passcode',
      chatEnabled: false,
    });

    expect(mockRpc).toHaveBeenCalledWith('create_room_with_template', {
      p_title: '周末露营',
      p_template_type: 'travel',
      p_join_mode: 'passcode',
      p_announcement: '',
      p_event_start_at: null,
      p_event_end_at: null,
      p_chat_enabled: false,
    });

    await createRoomWithTemplate({
      title: '社团招新',
      templateType: 'campus',
      joinMode: 'approval',
    });

    expect(mockRpc).toHaveBeenLastCalledWith('create_room_with_template', {
      p_title: '社团招新',
      p_template_type: 'campus',
      p_join_mode: 'approval',
      p_announcement: '',
      p_event_start_at: null,
      p_event_end_at: null,
      p_chat_enabled: null,
    });
  });

  it('updateRoomMetadata includes chat_enabled, event_start_at, and event_end_at in Supabase update payload', async () => {
    const updatedRoom = {
      id: 'room-1',
      title: '周末露营',
      announcement: '',
      template_type: 'travel',
      event_start_at: '2026-11-28T09:00:00.000Z',
      event_end_at: '2026-11-29T18:00:00.000Z',
      join_mode: 'passcode',
      room_code: 'K7M3P9',
      chat_enabled: true,
      allow_member_create_poll: true,
      status: 'active',
      archived_at: null,
      created_by: 'u1',
      created_at: '2026-11-22T10:00:00.000Z',
      updated_at: '2026-11-22T10:05:00.000Z',
    };

    const mockSingle = vi.fn().mockResolvedValue({ data: updatedRoom, error: null });
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
    const mockEq = vi.fn().mockReturnValue({ select: mockSelect });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });

    const result = await updateRoomMetadata('room-1', {
      chat_enabled: true,
      event_start_at: '2026-11-28T09:00:00.000Z',
      event_end_at: '2026-11-29T18:00:00.000Z',
    });

    expect(result).toEqual(updatedRoom);
    expect(mockFrom).toHaveBeenCalledWith('rooms');
    expect(mockUpdate).toHaveBeenCalledWith({
      chat_enabled: true,
      event_start_at: '2026-11-28T09:00:00.000Z',
      event_end_at: '2026-11-29T18:00:00.000Z',
    });
    expect(mockEq).toHaveBeenCalledWith('id', 'room-1');
  });

  it('leaveRoom calls leave_room RPC and maps HOST_CANNOT_LEAVE and ROOM_ARCHIVED via toRoomApiError', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    await leaveRoom('room-1');
    expect(mockRpc).toHaveBeenCalledWith('leave_room', {
      p_room_id: 'room-1',
    });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'ERROR: HOST_CANNOT_LEAVE' },
    });

    await expect(leaveRoom('room-1')).rejects.toMatchObject({
      code: 'HOST_CANNOT_LEAVE',
      message: '房主无法直接退出房间，你可以选择归档活动',
    });

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'ERROR: ROOM_ARCHIVED' },
    });

    await expect(leaveRoom('room-1')).rejects.toMatchObject({
      code: 'ROOM_ARCHIVED',
    });
  });
});
