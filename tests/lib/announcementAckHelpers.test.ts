import { describe, expect, it } from 'vitest';
import {
  applyOptimisticAnnouncementAck,
  computeAnnouncementAckSummary,
} from '@/src/lib/announcementAckHelpers';
import type {
  RoomAnnouncementAckRow,
  RoomMemberWithProfile,
} from '@/src/types/database';

function makeMember(
  userId: string,
  nickname: string,
  role: 'host' | 'admin' | 'member' = 'member',
  status: 'active' | 'pending' | 'kicked' = 'active',
  joinedAt = '2026-11-22T10:00:00.000Z',
): RoomMemberWithProfile {
  return {
    id: `mem-${userId}`,
    room_id: 'room-1',
    user_id: userId,
    role,
    status,
    apply_note: null,
    joined_at: joinedAt,
    profiles: {
      id: userId,
      nickname,
      avatar_color: '#F2843A',
      avatar_url: null,
    },
  };
}

describe('announcementAckHelpers', () => {
  it('returns hasAnnouncement=false when announcement is blank', () => {
    const summary = computeAnnouncementAckSummary({
      announcement: '   ',
      announcementVersion: '2026-11-23T08:00:00.000Z',
      members: [makeMember('u1', '房主', 'host')],
      acks: [],
      currentUserId: 'u1',
    });

    expect(summary.hasAnnouncement).toBe(false);
    expect(summary.ackedCount).toBe(0);
    expect(summary.unackedCount).toBe(0);
  });

  it('splits active members into acked and unacked and invalidates stale acks after announcement edits', () => {
    const members = [
      makeMember('u1', '阿橘', 'host', 'active', '2026-11-22T09:00:00.000Z'),
      makeMember('u2', '小满', 'member', 'active', '2026-11-22T09:05:00.000Z'),
      makeMember('u3', '阿明', 'member', 'active', '2026-11-22T09:10:00.000Z'),
      makeMember('u4', '待审批', 'member', 'pending', '2026-11-22T09:15:00.000Z'),
    ];

    const acks: RoomAnnouncementAckRow[] = [
      {
        room_id: 'room-1',
        user_id: 'u1',
        announcement_version: '2026-11-23T10:00:00.000Z',
        acked_at: '2026-11-23T10:01:00.000Z',
      },
      {
        // Stale ack from an earlier announcement version — must be treated as unacked!
        room_id: 'room-1',
        user_id: 'u2',
        announcement_version: '2026-11-23T08:00:00.000Z',
        acked_at: '2026-11-23T08:05:00.000Z',
      },
      {
        // Departed / non-member user — must be ignored
        room_id: 'room-1',
        user_id: 'u-left',
        announcement_version: '2026-11-23T10:00:00.000Z',
        acked_at: '2026-11-23T10:02:00.000Z',
      },
    ];

    const summary = computeAnnouncementAckSummary({
      announcement: '明早 8:30 南门集合，请带好雨伞！',
      announcementVersion: '2026-11-23T10:00:00.000Z',
      members,
      acks,
      currentUserId: 'u2',
    });

    expect(summary.hasAnnouncement).toBe(true);
    expect(summary.totalCount).toBe(3);
    expect(summary.ackedCount).toBe(1);
    expect(summary.unackedCount).toBe(2);
    expect(summary.hasCurrentUserAcked).toBe(false);
    expect(summary.ackedMembers.map((m) => m.member.user_id)).toEqual(['u1']);
    expect(summary.unackedMembers.map((m) => m.user_id)).toEqual(['u2', 'u3']);
  });

  it('optimistically upserts current user ack without duplicating existing rows', () => {
    const initial: RoomAnnouncementAckRow[] = [
      {
        room_id: 'room-1',
        user_id: 'u2',
        announcement_version: '2026-11-23T08:00:00.000Z',
        acked_at: '2026-11-23T08:05:00.000Z',
      },
    ];

    const updated = applyOptimisticAnnouncementAck(initial, {
      roomId: 'room-1',
      userId: 'u2',
      announcementVersion: '2026-11-23T10:00:00.000Z',
      ackedAt: '2026-11-23T10:03:00.000Z',
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]?.announcement_version).toBe('2026-11-23T10:00:00.000Z');
    expect(updated[0]?.acked_at).toBe('2026-11-23T10:03:00.000Z');

    const added = applyOptimisticAnnouncementAck(updated, {
      roomId: 'room-1',
      userId: 'u3',
      announcementVersion: '2026-11-23T10:00:00.000Z',
      ackedAt: '2026-11-23T10:04:00.000Z',
    });

    expect(added).toHaveLength(2);
  });
});
