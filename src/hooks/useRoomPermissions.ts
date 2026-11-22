import { useMemo } from 'react';
import type { MemberRole, RoomStatus } from '../types/database';

/** Inputs required to evaluate a user's permissions inside a PopRoom collaboration room. */
export interface RoomPermissionsInput {
  role: MemberRole | null;
  roomStatus: RoomStatus;
  currentUserId: string | null;
  allowMemberCreatePoll: boolean;
}

/** Computed capability flags and item-level authorization helpers matching Spec Section 5.6. */
export interface RoomPermissions {
  isArchived: boolean;
  isReadOnly: boolean;
  isHost: boolean;
  isAdminOrHost: boolean;
  canViewRoom: boolean;
  canExportRecap: boolean;
  canVote: boolean;
  canClaimTask: boolean;
  canComment: boolean;
  canManageBlocks: boolean;
  canCreatePollBlock: boolean;
  canLockPoll: boolean;
  canCreateItem: (allowMemberCreate?: boolean) => boolean;
  canEditOrDeleteItem: (createdBy: string | null) => boolean;
  canSetTaskStatus: (createdBy: string | null, assigneeIds: readonly string[]) => boolean;
  canManageTaskImages: (createdBy: string | null, assigneeIds: readonly string[]) => boolean;
  canReviewMembers: boolean;
  canKickMembers: boolean;
  canKickTarget: (targetRole: MemberRole) => boolean;
  canResetRoomCode: boolean;
  canViewLogs: boolean;
  canRestoreDeletedItem: boolean;
  canManageAdmins: boolean;
  canArchiveRoom: boolean;
  canEditRoomSettings: boolean;
}

/**
 * Pure permission engine implementing Spec Section 5.6 and the archived read-only iron rule.
 * Safe to call in Node/Vitest without React Native or Expo runtime dependencies.
 */
export function computeRoomPermissions(
  input: RoomPermissionsInput,
): RoomPermissions {
  const { role, roomStatus, currentUserId, allowMemberCreatePoll } = input;
  const isArchived = roomStatus === 'archived';
  const hasMembership = role !== null;
  const isHost = role === 'host';
  const isAdminOrHost = role === 'host' || role === 'admin';
  const isActiveMember = hasMembership && !isArchived;
  const isReadOnly = !isActiveMember;

  const isCreatorOrAssignee = (
    createdBy: string | null,
    assigneeIds: readonly string[],
  ): boolean =>
    currentUserId !== null &&
    (createdBy === currentUserId || assigneeIds.includes(currentUserId));

  return {
    isArchived,
    isReadOnly,
    isHost,
    isAdminOrHost,
    canViewRoom: hasMembership,
    canExportRecap: hasMembership,
    canVote: isActiveMember,
    canClaimTask: isActiveMember,
    canComment: isActiveMember,
    canManageBlocks: isActiveMember && isAdminOrHost,
    canCreatePollBlock:
      isActiveMember && (isAdminOrHost || allowMemberCreatePoll),
    canLockPoll: isActiveMember && isAdminOrHost,
    canCreateItem: (allowMemberCreate = true) =>
      isActiveMember && (isAdminOrHost || allowMemberCreate),
    canEditOrDeleteItem: (createdBy) => {
      if (!isActiveMember) {
        return false;
      }
      if (isAdminOrHost) {
        return true;
      }
      return currentUserId !== null && createdBy === currentUserId;
    },
    canSetTaskStatus: (createdBy, assigneeIds) => {
      if (!isActiveMember) {
        return false;
      }
      return isAdminOrHost || isCreatorOrAssignee(createdBy, assigneeIds);
    },
    canManageTaskImages: (createdBy, assigneeIds) => {
      if (!isActiveMember) {
        return false;
      }
      return isAdminOrHost || isCreatorOrAssignee(createdBy, assigneeIds);
    },
    canReviewMembers: isActiveMember && isAdminOrHost,
    canKickMembers: isActiveMember && isAdminOrHost,
    canKickTarget: (targetRole) => {
      if (!isActiveMember) {
        return false;
      }
      if (isHost) {
        return targetRole !== 'host';
      }
      if (role === 'admin') {
        return targetRole === 'member';
      }
      return false;
    },
    canResetRoomCode: isActiveMember && isAdminOrHost,
    canViewLogs: hasMembership && isAdminOrHost,
    canRestoreDeletedItem: isActiveMember && isAdminOrHost,
    canManageAdmins: isActiveMember && isHost,
    canArchiveRoom: isActiveMember && isHost,
    canEditRoomSettings: isActiveMember && isAdminOrHost,
  };
}

/** Memoized React hook wrapper around `computeRoomPermissions`. */
export function useRoomPermissions(
  input: RoomPermissionsInput,
): RoomPermissions {
  const { role, roomStatus, currentUserId, allowMemberCreatePoll } = input;
  return useMemo(
    () =>
      computeRoomPermissions({
        role,
        roomStatus,
        currentUserId,
        allowMemberCreatePoll,
      }),
    [role, roomStatus, currentUserId, allowMemberCreatePoll],
  );
}
