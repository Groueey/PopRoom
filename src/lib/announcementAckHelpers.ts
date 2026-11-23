import type {
  MemberRole,
  RoomAnnouncementAckRow,
  RoomMemberWithProfile,
} from '../types/database';

const ROLE_ORDER: Record<MemberRole, number> = {
  host: 0,
  admin: 1,
  member: 2,
};

export interface AckedMemberEntry {
  member: RoomMemberWithProfile;
  ackedAt: string;
}

export interface AnnouncementAckSummaryInput {
  announcement: string;
  announcementVersion?: string | null;
  members: readonly RoomMemberWithProfile[];
  acks: readonly RoomAnnouncementAckRow[];
  currentUserId: string | null;
}

export interface AnnouncementAckSummary {
  hasAnnouncement: boolean;
  totalCount: number;
  ackedCount: number;
  unackedCount: number;
  hasCurrentUserAcked: boolean;
  ackedMembers: AckedMemberEntry[];
  unackedMembers: RoomMemberWithProfile[];
}

export interface OptimisticAnnouncementAckDraft {
  roomId: string;
  userId: string;
  announcementVersion: string;
  ackedAt?: string;
}

/**
 * Computes current-version announcement read/confirmation progress across active room members.
 * Stale acknowledgements from older announcement edits automatically reset to unacked.
 */
export function computeAnnouncementAckSummary(
  input: AnnouncementAckSummaryInput,
): AnnouncementAckSummary {
  const { announcement, announcementVersion, members, acks, currentUserId } = input;
  const hasAnnouncement = announcement.trim().length > 0;
  if (!hasAnnouncement) {
    return {
      hasAnnouncement: false,
      totalCount: 0,
      ackedCount: 0,
      unackedCount: 0,
      hasCurrentUserAcked: false,
      ackedMembers: [],
      unackedMembers: [],
    };
  }

  const versionMs = announcementVersion ? Date.parse(announcementVersion) : Number.NaN;
  const hasValidVersion = Number.isFinite(versionMs);

  const validAckByUser = new Map<string, RoomAnnouncementAckRow>();
  for (const ack of acks) {
    if (!hasValidVersion) {
      validAckByUser.set(ack.user_id, ack);
      continue;
    }
    const ackVersionMs = Date.parse(ack.announcement_version);
    if (Number.isFinite(ackVersionMs) && ackVersionMs >= versionMs) {
      validAckByUser.set(ack.user_id, ack);
    }
  }

  const activeMembers = members
    .filter((member) => member.status === 'active')
    .slice()
    .sort((a, b) => {
      const roleDiff = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (roleDiff !== 0) {
        return roleDiff;
      }
      return Date.parse(a.joined_at) - Date.parse(b.joined_at);
    });

  const ackedMembers: AckedMemberEntry[] = [];
  const unackedMembers: RoomMemberWithProfile[] = [];

  for (const member of activeMembers) {
    const ack = validAckByUser.get(member.user_id);
    if (ack) {
      ackedMembers.push({ member, ackedAt: ack.acked_at });
    } else {
      unackedMembers.push(member);
    }
  }

  ackedMembers.sort((a, b) => Date.parse(a.ackedAt) - Date.parse(b.ackedAt));

  return {
    hasAnnouncement: true,
    totalCount: activeMembers.length,
    ackedCount: ackedMembers.length,
    unackedCount: unackedMembers.length,
    hasCurrentUserAcked: Boolean(currentUserId && validAckByUser.has(currentUserId)),
    ackedMembers,
    unackedMembers,
  };
}

/** Optimistically inserts or updates the current user's announcement acknowledgement row. */
export function applyOptimisticAnnouncementAck(
  existing: readonly RoomAnnouncementAckRow[],
  draft: OptimisticAnnouncementAckDraft,
): RoomAnnouncementAckRow[] {
  const nextRow: RoomAnnouncementAckRow = {
    room_id: draft.roomId,
    user_id: draft.userId,
    announcement_version: draft.announcementVersion,
    acked_at: draft.ackedAt ?? new Date().toISOString(),
  };

  let replaced = false;
  const next = existing.map((row) => {
    if (row.room_id === draft.roomId && row.user_id === draft.userId) {
      replaced = true;
      return nextRow;
    }
    return row;
  });

  return replaced ? next : [...next, nextRow];
}

/** Formats an acknowledgement timestamp into compact `MM/DD HH:mm` or `HH:mm`. */
export function formatAckTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return '';
  }
  const d = new Date(ms);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return `${hh}:${min}`;
  }
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${min}`;
}
