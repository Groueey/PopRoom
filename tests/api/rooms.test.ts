import { describe, expect, it } from 'vitest';
import {
  MAX_ROOM_TITLE_LENGTH,
  RoomApiError,
  mapRoomError,
  prepareJoinPayload,
  validateCreateRoomInput,
  validateUpdateRoomMetadataInput,
} from '@/src/api/roomHelpers';
import type { JoinMode, TemplateType } from '@/src/types/database';

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
  it('validates partial room metadata updates cleanly', () => {
    const patch = validateUpdateRoomMetadataInput({
      title: '  新标题  ',
      announcement: '  周日出发  ',
      join_mode: 'approval',
      allow_member_create_poll: false,
    });

    expect(patch).toEqual({
      title: '新标题',
      announcement: '周日出发',
      join_mode: 'approval',
      allow_member_create_poll: false,
    });

    expect(() => validateUpdateRoomMetadataInput({ title: '  ' })).toThrow(
      RoomApiError,
    );
  });
});
