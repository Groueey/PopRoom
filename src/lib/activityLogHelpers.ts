import type { ActivityAction, ActivityLogRow } from '../types/database';

/** Display-ready projection of a room `activity_logs` record. */
export interface FormattedActivityLog {
  id: string;
  summary: string;
  detail: string;
  canRestore: boolean;
  isRestored: boolean;
  createdAt: string;
}

/** Timeline filter options supported by the activity log screen. */
export type ActivityLogFilterMode = 'all' | 'restorable';

const SLOT_PERIOD_LABELS: Record<string, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
};

const MEMBER_ROLE_LABELS: Record<string, string> = {
  host: '房主',
  admin: '管理员',
  member: '成员',
};

const JOIN_MODE_LABELS: Record<string, string> = {
  passcode: '凭码直进',
  approval: '凭码申请审批',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readFiniteNumber(
  record: Record<string, unknown> | null,
  key: string,
): number | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

function truncateText(text: string, maxLength = 60): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) {
    return text;
  }
  return `${chars.slice(0, maxLength).join('')}…`;
}

/** Formats an ISO timestamp into `M/D HH:mm`, returning a safe fallback on invalid dates. */
export function formatActivityLogTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return '未知时间';
  }
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()} ${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
}

/** Maps an `ActivityAction` to its Chinese badge label and semantic variant. */
export function getActivityActionMeta(action: ActivityAction): {
  label: string;
  badgeVariant: 'danger' | 'success' | 'warning' | 'neutral';
} {
  switch (action) {
    case 'delete_item':
      return { label: '删除条目', badgeVariant: 'danger' };
    case 'restore_item':
      return { label: '恢复条目', badgeVariant: 'success' };
    case 'kick_member':
      return { label: '移出成员', badgeVariant: 'warning' };
    case 'update_room':
      return { label: '房间设置', badgeVariant: 'neutral' };
    case 'delete_message':
      return { label: '撤回消息', badgeVariant: 'danger' };
    case 'leave_room':
      return { label: '退出房间', badgeVariant: 'warning' };
  }
}

/**
 * Returns `true` only when the log is an unrestored soft-delete on `block_items`
 * and the caller holds active undo permission (`!isArchived && isAdminOrHost`).
 */
export function canRestoreLogEntry(
  log: ActivityLogRow,
  canUndoDelete: boolean,
): boolean {
  return (
    canUndoDelete &&
    log.action === 'delete_item' &&
    log.target_table === 'block_items' &&
    log.restored_at === null
  );
}

function extractItemSnapshotFields(beforeSnapshot: unknown): {
  itemTitle: string | null;
  detailText: string | null;
} {
  const snapshot = isRecord(beforeSnapshot) ? beforeSnapshot : null;
  const data = snapshot && isRecord(snapshot.data) ? snapshot.data : null;

  const itemTitle =
    readNonEmptyString(data, 'title') ??
    readNonEmptyString(data, 'label') ??
    readNonEmptyString(snapshot, 'title') ??
    readNonEmptyString(snapshot, 'label');

  const source = data ?? snapshot;
  const parts: string[] = [];

  const amount = readFiniteNumber(source, 'amount');
  if (amount !== null) {
    parts.push(`金额 ¥${amount.toFixed(2)}`);
  }

  const groupLabel = readNonEmptyString(source, 'groupLabel');
  const startTime = readNonEmptyString(source, 'startTime');
  const endTime = readNonEmptyString(source, 'endTime');
  if (groupLabel || startTime) {
    const timeRange =
      startTime && endTime ? `${startTime}-${endTime}` : (startTime ?? '');
    parts.push([groupLabel, timeRange].filter(Boolean).join(' '));
  }

  const locationName = readNonEmptyString(source, 'locationName');
  if (locationName) {
    parts.push(`地点：${truncateText(locationName, 24)}`);
  }

  const slotDate = readNonEmptyString(source, 'slotDate');
  const slotPeriod = readNonEmptyString(source, 'slotPeriod');
  if (slotDate || slotPeriod) {
    const periodLabel = slotPeriod
      ? (SLOT_PERIOD_LABELS[slotPeriod] ?? slotPeriod)
      : '';
    parts.push([slotDate, periodLabel].filter(Boolean).join(' '));
  }

  const description = readNonEmptyString(source, 'description');
  if (description) {
    parts.push(truncateText(description, 60));
  }

  return {
    itemTitle,
    detailText: parts.length > 0 ? parts.join(' · ') : null,
  };
}

function formatDeleteItemEntry(
  log: ActivityLogRow,
  safeActor: string,
  canUndoDelete: boolean,
): FormattedActivityLog {
  const { itemTitle, detailText } = extractItemSnapshotFields(
    log.before_snapshot,
  );
  const isRestored = log.restored_at !== null;
  const canRestore = canRestoreLogEntry(log, canUndoDelete);

  const summary = itemTitle
    ? `${safeActor} 删除了「${itemTitle}」`
    : `${safeActor} 删除了一条积木内容`;

  let detail = detailText ?? '';
  if (isRestored && log.restored_at) {
    const restoredLabel = `已于 ${formatActivityLogTimestamp(log.restored_at)} 恢复`;
    detail = detail ? `${detail} · ${restoredLabel}` : restoredLabel;
  } else if (!detail) {
    detail = canRestore
      ? '可点击右侧按钮一键恢复至原积木'
      : '记录已保留原始快照内容';
  }

  return {
    id: log.id,
    summary,
    detail,
    canRestore,
    isRestored,
    createdAt: log.created_at,
  };
}

function formatRestoreItemEntry(
  log: ActivityLogRow,
  safeActor: string,
): FormattedActivityLog {
  const { itemTitle, detailText } = extractItemSnapshotFields(
    log.before_snapshot,
  );

  const summary = itemTitle
    ? `${safeActor} 恢复了「${itemTitle}」`
    : `${safeActor} 恢复了已删除条目`;

  return {
    id: log.id,
    summary,
    detail: detailText ?? '已撤销删除并放回原积木中',
    canRestore: false,
    isRestored: log.restored_at !== null,
    createdAt: log.created_at,
  };
}

function formatKickMemberEntry(
  log: ActivityLogRow,
  safeActor: string,
): FormattedActivityLog {
  const snapshot = isRecord(log.before_snapshot) ? log.before_snapshot : null;
  const snapshotProfile =
    snapshot && isRecord(snapshot.profiles) ? snapshot.profiles : null;
  const targetNickname =
    readNonEmptyString(snapshot, 'nickname') ??
    readNonEmptyString(snapshot, 'targetName') ??
    readNonEmptyString(snapshotProfile, 'nickname');
  const rawRole = readNonEmptyString(snapshot, 'role');
  const roleLabel = rawRole ? (MEMBER_ROLE_LABELS[rawRole] ?? rawRole) : null;

  let summary: string;
  if (targetNickname) {
    summary = `${safeActor} 移出了成员「${targetNickname}」`;
  } else if (rawRole === 'admin') {
    summary = `${safeActor} 移出了管理员`;
  } else {
    summary = `${safeActor} 移出了一名成员`;
  }

  const detail = roleLabel
    ? `原身份：${roleLabel} · 移出后不可再通过房间码加入`
    : '成员已被移出房间，无法再通过房间码加入';

  return {
    id: log.id,
    summary,
    detail,
    canRestore: false,
    isRestored: log.restored_at !== null,
    createdAt: log.created_at,
  };
}

function formatUpdateRoomEntry(
  log: ActivityLogRow,
  safeActor: string,
): FormattedActivityLog {
  const snapshot = isRecord(log.before_snapshot) ? log.before_snapshot : null;
  const previousTitle = readNonEmptyString(snapshot, 'title');
  const previousJoinMode = readNonEmptyString(snapshot, 'join_mode');
  const previousAnnouncement = readNonEmptyString(snapshot, 'announcement');

  const detailParts: string[] = [];
  if (previousTitle) {
    detailParts.push(`变更前名称：${previousTitle}`);
  }
  if (previousJoinMode) {
    detailParts.push(
      `变更前门禁：${JOIN_MODE_LABELS[previousJoinMode] ?? previousJoinMode}`,
    );
  }
  if (previousAnnouncement) {
    detailParts.push(`变更前公告：${truncateText(previousAnnouncement, 30)}`);
  }

  return {
    id: log.id,
    summary: `${safeActor} 更新了房间设置`,
    detail:
      detailParts.length > 0
        ? detailParts.join(' · ')
        : '房间基础信息或门禁配置已更新',
    canRestore: false,
    isRestored: log.restored_at !== null,
    createdAt: log.created_at,
  };
}

function formatDeleteMessageEntry(
  log: ActivityLogRow,
  safeActor: string,
): FormattedActivityLog {
  const snapshot = isRecord(log.before_snapshot) ? log.before_snapshot : null;
  const content = readNonEmptyString(snapshot, 'content');

  return {
    id: log.id,
    summary: `${safeActor} 撤回了一条聊天消息`,
    detail: content
      ? `原消息内容：${truncateText(content, 40)}`
      : '该聊天消息已被删除',
    canRestore: false,
    isRestored: log.restored_at !== null,
    createdAt: log.created_at,
  };
}

function formatLeaveRoomEntry(
  log: ActivityLogRow,
  safeActor: string,
): FormattedActivityLog {
  const snapshot = isRecord(log.before_snapshot) ? log.before_snapshot : null;
  const rawRole = readNonEmptyString(snapshot, 'role');
  const roleLabel = rawRole ? (MEMBER_ROLE_LABELS[rawRole] ?? rawRole) : null;

  return {
    id: log.id,
    summary: `${safeActor} 退出了房间`,
    detail: roleLabel
      ? `原身份：${roleLabel} · 已主动离开该活动房间`
      : '成员已主动离开该活动房间',
    canRestore: false,
    isRestored: log.restored_at !== null,
    createdAt: log.created_at,
  };
}

/**
 * Formats an `activity_logs` row into Chinese summary/detail strings and computes restore eligibility.
 * Gracefully handles partial or null `before_snapshot` payloads across all action types.
 */
export function formatActivityLogEntry(
  log: ActivityLogRow,
  actorName: string,
  canUndoDelete: boolean,
): FormattedActivityLog {
  const safeActor = actorName.trim() || '系统成员';

  switch (log.action) {
    case 'delete_item':
      return formatDeleteItemEntry(log, safeActor, canUndoDelete);
    case 'restore_item':
      return formatRestoreItemEntry(log, safeActor);
    case 'kick_member':
      return formatKickMemberEntry(log, safeActor);
    case 'update_room':
      return formatUpdateRoomEntry(log, safeActor);
    case 'delete_message':
      return formatDeleteMessageEntry(log, safeActor);
    case 'leave_room':
      return formatLeaveRoomEntry(log, safeActor);
  }
}

/** Filters chronological log entries for the "全部日志" / "可撤销删除" filter pills. */
export function filterActivityLogs<T extends ActivityLogRow>(
  logs: readonly T[],
  mode: ActivityLogFilterMode,
  canUndoDelete: boolean,
): T[] {
  if (mode === 'all') {
    return logs.slice();
  }
  return logs.filter((log) => canRestoreLogEntry(log, canUndoDelete));
}
