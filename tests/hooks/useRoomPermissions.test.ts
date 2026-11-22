import { describe, expect, it } from 'vitest';
import { computeRoomPermissions } from '@/src/hooks/useRoomPermissions';

describe('computeRoomPermissions (Spec 5.6 & Review Focus #4)', () => {
  const userId = 'user-1';
  const otherUserId = 'user-2';

  it('grants full permissions to host on an active room', () => {
    const p = computeRoomPermissions({
      role: 'host',
      roomStatus: 'active',
      currentUserId: userId,
      allowMemberCreatePoll: false,
    });

    expect(p.isArchived).toBe(false);
    expect(p.isReadOnly).toBe(false);
    expect(p.isHost).toBe(true);
    expect(p.isAdminOrHost).toBe(true);
    expect(p.canViewRoom).toBe(true);
    expect(p.canExportRecap).toBe(true);
    expect(p.canVote).toBe(true);
    expect(p.canClaimTask).toBe(true);
    expect(p.canComment).toBe(true);
    expect(p.canManageBlocks).toBe(true);
    expect(p.canCreatePollBlock).toBe(true);
    expect(p.canLockPoll).toBe(true);
    expect(p.canCreateItem(false)).toBe(true);
    expect(p.canEditOrDeleteItem(otherUserId)).toBe(true);
    expect(p.canSetTaskStatus(otherUserId, [])).toBe(true);
    expect(p.canManageTaskImages(otherUserId, [])).toBe(true);
    expect(p.canReviewMembers).toBe(true);
    expect(p.canKickMembers).toBe(true);
    expect(p.canKickTarget('admin')).toBe(true);
    expect(p.canKickTarget('member')).toBe(true);
    expect(p.canKickTarget('host')).toBe(false);
    expect(p.canResetRoomCode).toBe(true);
    expect(p.canViewLogs).toBe(true);
    expect(p.canRestoreDeletedItem).toBe(true);
    expect(p.canManageAdmins).toBe(true);
    expect(p.canArchiveRoom).toBe(true);
    expect(p.canEditRoomSettings).toBe(true);
  });

  it('grants admin management permissions except host-only admin promotion and room archival', () => {
    const p = computeRoomPermissions({
      role: 'admin',
      roomStatus: 'active',
      currentUserId: userId,
      allowMemberCreatePoll: false,
    });

    expect(p.isHost).toBe(false);
    expect(p.isAdminOrHost).toBe(true);
    expect(p.canViewRoom).toBe(true);
    expect(p.canExportRecap).toBe(true);
    expect(p.canVote).toBe(true);
    expect(p.canClaimTask).toBe(true);
    expect(p.canComment).toBe(true);
    expect(p.canManageBlocks).toBe(true);
    expect(p.canCreatePollBlock).toBe(true);
    expect(p.canLockPoll).toBe(true);
    expect(p.canCreateItem(false)).toBe(true);
    expect(p.canEditOrDeleteItem(otherUserId)).toBe(true);
    expect(p.canSetTaskStatus(otherUserId, [])).toBe(true);
    expect(p.canManageTaskImages(otherUserId, [])).toBe(true);
    expect(p.canReviewMembers).toBe(true);
    expect(p.canKickMembers).toBe(true);
    expect(p.canKickTarget('member')).toBe(true);
    expect(p.canKickTarget('admin')).toBe(false);
    expect(p.canKickTarget('host')).toBe(false);
    expect(p.canResetRoomCode).toBe(true);
    expect(p.canViewLogs).toBe(true);
    expect(p.canRestoreDeletedItem).toBe(true);
    expect(p.canEditRoomSettings).toBe(true);
    expect(p.canManageAdmins).toBe(false);
    expect(p.canArchiveRoom).toBe(false);
  });

  it('enforces member boundaries: own items, assigned/created tasks, and allowMemberCreatePoll', () => {
    const pDenied = computeRoomPermissions({
      role: 'member',
      roomStatus: 'active',
      currentUserId: userId,
      allowMemberCreatePoll: false,
    });

    expect(pDenied.isHost).toBe(false);
    expect(pDenied.isAdminOrHost).toBe(false);
    expect(pDenied.canViewRoom).toBe(true);
    expect(pDenied.canExportRecap).toBe(true);
    expect(pDenied.canVote).toBe(true);
    expect(pDenied.canClaimTask).toBe(true);
    expect(pDenied.canComment).toBe(true);

    expect(pDenied.canManageBlocks).toBe(false);
    expect(pDenied.canCreatePollBlock).toBe(false);
    expect(pDenied.canLockPoll).toBe(false);

    expect(pDenied.canCreateItem(true)).toBe(true);
    expect(pDenied.canCreateItem(false)).toBe(false);

    expect(pDenied.canEditOrDeleteItem(userId)).toBe(true);
    expect(pDenied.canEditOrDeleteItem(otherUserId)).toBe(false);
    expect(pDenied.canEditOrDeleteItem(null)).toBe(false);

    // Task status & images: creator or assignee -> true; unrelated -> false
    expect(pDenied.canSetTaskStatus(userId, [])).toBe(true);
    expect(pDenied.canSetTaskStatus(otherUserId, [userId])).toBe(true);
    expect(pDenied.canSetTaskStatus(otherUserId, [otherUserId])).toBe(false);
    expect(pDenied.canManageTaskImages(userId, [])).toBe(true);
    expect(pDenied.canManageTaskImages(otherUserId, [userId])).toBe(true);
    expect(pDenied.canManageTaskImages(otherUserId, [])).toBe(false);

    expect(pDenied.canReviewMembers).toBe(false);
    expect(pDenied.canKickMembers).toBe(false);
    expect(pDenied.canKickTarget('member')).toBe(false);
    expect(pDenied.canResetRoomCode).toBe(false);
    expect(pDenied.canViewLogs).toBe(false);
    expect(pDenied.canRestoreDeletedItem).toBe(false);
    expect(pDenied.canManageAdmins).toBe(false);
    expect(pDenied.canArchiveRoom).toBe(false);
    expect(pDenied.canEditRoomSettings).toBe(false);

    const pAllowedPoll = computeRoomPermissions({
      role: 'member',
      roomStatus: 'active',
      currentUserId: userId,
      allowMemberCreatePoll: true,
    });
    expect(pAllowedPoll.canCreatePollBlock).toBe(true);
    expect(pAllowedPoll.canManageBlocks).toBe(false);
  });

  it('locks all mutations when roomStatus is archived for host, admin, and member while keeping read & export', () => {
    for (const role of ['host', 'admin', 'member'] as const) {
      const p = computeRoomPermissions({
        role,
        roomStatus: 'archived',
        currentUserId: userId,
        allowMemberCreatePoll: true,
      });

      expect(p.isArchived).toBe(true);
      expect(p.isReadOnly).toBe(true);
      expect(p.canViewRoom).toBe(true);
      expect(p.canExportRecap).toBe(true);

      expect(p.canVote).toBe(false);
      expect(p.canClaimTask).toBe(false);
      expect(p.canComment).toBe(false);
      expect(p.canManageBlocks).toBe(false);
      expect(p.canCreatePollBlock).toBe(false);
      expect(p.canLockPoll).toBe(false);
      expect(p.canCreateItem(true)).toBe(false);
      expect(p.canEditOrDeleteItem(userId)).toBe(false);
      expect(p.canSetTaskStatus(userId, [userId])).toBe(false);
      expect(p.canManageTaskImages(userId, [userId])).toBe(false);
      expect(p.canReviewMembers).toBe(false);
      expect(p.canKickMembers).toBe(false);
      expect(p.canKickTarget('member')).toBe(false);
      expect(p.canResetRoomCode).toBe(false);
      expect(p.canRestoreDeletedItem).toBe(false);
      expect(p.canManageAdmins).toBe(false);
      expect(p.canArchiveRoom).toBe(false);
      expect(p.canEditRoomSettings).toBe(false);

      // Logs are read-only viewable by host/admin after archival, denied for member
      expect(p.canViewLogs).toBe(role === 'host' || role === 'admin');
    }
  });

  it('denies all permissions when role is null', () => {
    const p = computeRoomPermissions({
      role: null,
      roomStatus: 'active',
      currentUserId: userId,
      allowMemberCreatePoll: true,
    });

    expect(p.isReadOnly).toBe(true);
    expect(p.canViewRoom).toBe(false);
    expect(p.canExportRecap).toBe(false);
    expect(p.canVote).toBe(false);
    expect(p.canClaimTask).toBe(false);
    expect(p.canComment).toBe(false);
    expect(p.canCreateItem(true)).toBe(false);
    expect(p.canEditOrDeleteItem(userId)).toBe(false);
    expect(p.canSetTaskStatus(userId, [userId])).toBe(false);
    expect(p.canManageTaskImages(userId, [userId])).toBe(false);
    expect(p.canViewLogs).toBe(false);
  });
});
