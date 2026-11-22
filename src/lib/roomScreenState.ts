import { RoomApiError, mapRoomError } from '../api/roomHelpers';
import type {
  RoomMemberRow,
  RoomMemberWithProfile,
  RoomRow,
} from '../types/database';

/** Room-scoped screen variants sharing offline stale-cache and permission guards. */
export type RoomScreenMode = 'board' | 'export' | 'logs' | 'settings';

/** Input state evaluated to determine loading, error, or cached-ready UI for room screens. */
export interface RoomScreenStateInput {
  mode: RoomScreenMode;
  room: RoomRow | undefined;
  roomLoading: boolean;
  roomError: unknown;
  members: readonly RoomMemberWithProfile[];
  membersLoading: boolean;
  membersError: unknown;
  myRawMembership: RoomMemberRow | null;
  canAccess: boolean;
  blocksCount?: number;
  blocksLoading?: boolean;
  blocksError?: unknown;
  hasPollTallies?: boolean;
  talliesLoading?: boolean;
  talliesError?: unknown;
  logsCount?: number;
  logsLoading?: boolean;
  logsError?: unknown;
}

/** Resolved screen rendering branch for room board, export, logs, and settings screens. */
export type RoomScreenStatus =
  | { kind: 'loading' }
  | {
      kind: 'full_error';
      title: string;
      message: string;
      canRetry: boolean;
    }
  | { kind: 'members_error'; message: string }
  | { kind: 'permission_denied' }
  | { kind: 'ready'; syncWarning: string | null };

const FULL_ERROR_TITLES: Record<RoomScreenMode, string> = {
  board: '无法进入该协作房间',
  export: '无法加载活动复盘',
  logs: '无法加载操作日志',
  settings: '无法加载房间设置',
};

function pickFirstSyncError(input: RoomScreenStateInput): unknown {
  if (input.roomError) {
    return input.roomError;
  }
  if (input.membersError) {
    return input.membersError;
  }
  if (
    (input.mode === 'board' || input.mode === 'export') &&
    input.blocksError
  ) {
    return input.blocksError;
  }
  if (
    (input.mode === 'board' || input.mode === 'export') &&
    input.talliesError
  ) {
    return input.talliesError;
  }
  if (input.mode === 'logs' && input.logsError && (input.logsCount ?? 0) > 0) {
    return input.logsError;
  }
  return null;
}

/**
 * Resolves whether a room screen should show initial loading, a fatal full-screen error
 * (when no cached `room` exists or the user was kicked), a retryable member-verification error,
 * a permission-denied screen, or cached UI with an optional inline sync-failed warning banner.
 */
export function resolveRoomScreenState(
  input: RoomScreenStateInput,
): RoomScreenStatus {
  const roomMissing = !input.room;
  const membersEmpty = input.members.length === 0;
  const blocksEmpty = (input.blocksCount ?? 0) === 0;

  const waitingOnBase =
    (input.roomLoading && roomMissing) ||
    (input.membersLoading && membersEmpty);
  const waitingOnExportData =
    input.mode === 'export' &&
    ((Boolean(input.blocksLoading) && blocksEmpty) ||
      (Boolean(input.talliesLoading) && !input.hasPollTallies));

  if (waitingOnBase || waitingOnExportData) {
    return { kind: 'loading' };
  }

  const isKicked = input.myRawMembership?.status === 'kicked';
  if (!input.room || isKicked) {
    const message = isKicked
      ? mapRoomError(new RoomApiError('USER_KICKED'))
      : mapRoomError(input.roomError);
    return {
      kind: 'full_error',
      title: FULL_ERROR_TITLES[input.mode],
      message,
      canRetry: !isKicked,
    };
  }

  if (
    (input.mode === 'export' || input.mode === 'logs') &&
    membersEmpty &&
    Boolean(input.membersError)
  ) {
    return {
      kind: 'members_error',
      message: mapRoomError(input.membersError),
    };
  }

  if (
    (input.mode === 'export' || input.mode === 'logs') &&
    !input.canAccess
  ) {
    return { kind: 'permission_denied' };
  }

  const syncError = pickFirstSyncError(input);
  const syncWarning = syncError
    ? `当前离线或同步受限（${mapRoomError(syncError)}），正在展示本地缓存数据`
    : null;

  return { kind: 'ready', syncWarning };
}
