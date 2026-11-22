import { describe, expect, it } from 'vitest';
import { resolveRoomScreenState } from '@/src/lib/roomScreenState';
import type {
  RoomMemberRow,
  RoomMemberWithProfile,
  RoomRow,
} from '@/src/types/database';

function makeRoom(overrides: Partial<RoomRow> = {}): RoomRow {
  return {
    id: 'room-1',
    title: '周末露营局',
    announcement: '周六九点集合',
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
    created_at: '2026-11-22T00:00:00Z',
    updated_at: '2026-11-22T00:00:00Z',
    ...overrides,
  };
}

function makeMember(
  overrides: Partial<RoomMemberWithProfile> = {},
): RoomMemberWithProfile {
  return {
    id: 'm1',
    room_id: 'room-1',
    user_id: 'u1',
    role: 'host',
    status: 'active',
    apply_note: null,
    joined_at: '2026-11-22T00:00:00Z',
    profiles: {
      id: 'u1',
      nickname: '阿橘',
      avatar_color: '#F97316',
      avatar_url: null,
    },
    ...overrides,
  };
}

describe('resolveRoomScreenState (Critical #1 stale-cache & Important #2 error handling)', () => {
  it('renders cached room with inline syncWarning across board, export, logs, and settings when background refetch fails', () => {
    const room = makeRoom();
    const members = [makeMember()];
    const networkErr = new Error('Network request failed');

    for (const mode of ['board', 'export', 'logs', 'settings'] as const) {
      const state = resolveRoomScreenState({
        mode,
        room,
        roomLoading: false,
        roomError: networkErr,
        members,
        membersLoading: false,
        membersError: networkErr,
        myRawMembership: members[0] ?? null,
        canAccess: true,
        blocksCount: 2,
        blocksLoading: false,
        blocksError: networkErr,
        hasPollTallies: true,
        talliesLoading: false,
        talliesError: networkErr,
        logsCount: 3,
        logsLoading: false,
        logsError: networkErr,
      });

      expect(state.kind).toBe('ready');
      if (state.kind === 'ready') {
        expect(state.syncWarning).toContain('网络');
      }
    }
  });

  it('shows full_error when room is missing or current user is kicked', () => {
    const missingRoom = resolveRoomScreenState({
      mode: 'board',
      room: undefined,
      roomLoading: false,
      roomError: new Error('ROOM_NOT_FOUND'),
      members: [],
      membersLoading: false,
      membersError: null,
      myRawMembership: null,
      canAccess: false,
    });
    expect(missingRoom.kind).toBe('full_error');
    if (missingRoom.kind === 'full_error') {
      expect(missingRoom.message).toContain('房间不存在');
    }

    const kickedMember: RoomMemberRow = makeMember({ status: 'kicked' });
    const kickedWithCache = resolveRoomScreenState({
      mode: 'export',
      room: makeRoom(),
      roomLoading: false,
      roomError: null,
      members: [makeMember({ status: 'kicked' })],
      membersLoading: false,
      membersError: null,
      myRawMembership: kickedMember,
      canAccess: false,
      blocksCount: 1,
      blocksLoading: false,
      hasPollTallies: true,
      talliesLoading: false,
    });
    expect(kickedWithCache.kind).toBe('full_error');
    if (kickedWithCache.kind === 'full_error') {
      expect(kickedWithCache.message).toContain('移出');
    }
  });

  it('returns members_error instead of permission_denied when members are empty and membersError occurred on export and logs', () => {
    const room = makeRoom();
    const err = new Error('Network request failed');

    for (const mode of ['export', 'logs'] as const) {
      const state = resolveRoomScreenState({
        mode,
        room,
        roomLoading: false,
        roomError: null,
        members: [],
        membersLoading: false,
        membersError: err,
        myRawMembership: null,
        canAccess: false,
        blocksCount: 1,
        blocksLoading: false,
        hasPollTallies: true,
        talliesLoading: false,
      });

      expect(state.kind).toBe('members_error');
      if (state.kind === 'members_error') {
        expect(state.message).toContain('网络');
      }
    }
  });

  it('returns permission_denied when members loaded cleanly and canAccess is false', () => {
    const room = makeRoom();
    const otherMember = makeMember({ user_id: 'u2', role: 'member' });

    const logsDenied = resolveRoomScreenState({
      mode: 'logs',
      room,
      roomLoading: false,
      roomError: null,
      members: [otherMember],
      membersLoading: false,
      membersError: null,
      myRawMembership: otherMember,
      canAccess: false,
    });
    expect(logsDenied.kind).toBe('permission_denied');
  });

  it('keeps export in loading while talliesLoading is true and pollTallies is missing, and surfaces talliesError warning once finished', () => {
    const room = makeRoom();
    const members = [makeMember()];

    const loadingTallies = resolveRoomScreenState({
      mode: 'export',
      room,
      roomLoading: false,
      roomError: null,
      members,
      membersLoading: false,
      membersError: null,
      myRawMembership: members[0] ?? null,
      canAccess: true,
      blocksCount: 1,
      blocksLoading: false,
      hasPollTallies: false,
      talliesLoading: true,
      talliesError: null,
    });
    expect(loadingTallies.kind).toBe('loading');

    const failedTallies = resolveRoomScreenState({
      mode: 'export',
      room,
      roomLoading: false,
      roomError: null,
      members,
      membersLoading: false,
      membersError: null,
      myRawMembership: members[0] ?? null,
      canAccess: true,
      blocksCount: 1,
      blocksLoading: false,
      hasPollTallies: false,
      talliesLoading: false,
      talliesError: new Error('Network request failed'),
    });
    expect(failedTallies.kind).toBe('ready');
    if (failedTallies.kind === 'ready') {
      expect(failedTallies.syncWarning).toContain('网络');
    }
  });
});
