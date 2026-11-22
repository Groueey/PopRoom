import {
  MAX_TASK_IMAGES,
  type ParsedBlock,
  type ParsedBlockItem,
} from '../api/blockHelpers';
import { RoomApiError } from '../api/roomHelpers';
import type { TaskItemData, TaskStatus } from '../schemas/blocks';

/** Human-readable Chinese labels for task lifecycle states. */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  unclaimed: '待认领',
  in_progress: '进行中',
  done: '已完成',
};

/** Aggregated status counts for a task block summary badge. */
export interface TaskCompletionStats {
  total: number;
  done: number;
  inProgress: number;
  unclaimed: number;
}

/**
 * Computes an immutable optimistic `TaskItemData` update mirroring `toggle_task_claim` RPC:
 * - Adding `userId` transitions `unclaimed` -> `in_progress` (leaving `done` / `in_progress` intact).
 * - Removing `userId` transitions `in_progress` -> `unclaimed` only when no assignees remain,
 *   while leaving `done` unchanged.
 */
export function applyOptimisticTaskClaim(
  data: TaskItemData,
  userId: string,
): TaskItemData {
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) {
    return {
      ...data,
      assigneeIds: [...data.assigneeIds],
      imageUrls: [...data.imageUrls],
    };
  }

  const alreadyClaimed = data.assigneeIds.includes(trimmedUserId);
  if (alreadyClaimed) {
    const nextAssignees = data.assigneeIds.filter((id) => id !== trimmedUserId);
    const nextStatus: TaskStatus =
      nextAssignees.length === 0 && data.status === 'in_progress'
        ? 'unclaimed'
        : data.status;

    return {
      ...data,
      assigneeIds: nextAssignees,
      imageUrls: [...data.imageUrls],
      status: nextStatus,
    };
  }

  const nextAssignees = [...data.assigneeIds, trimmedUserId];
  const nextStatus: TaskStatus =
    data.status === 'unclaimed' ? 'in_progress' : data.status;

  return {
    ...data,
    assigneeIds: nextAssignees,
    imageUrls: [...data.imageUrls],
    status: nextStatus,
  };
}

/**
 * Computes an immutable optimistic `TaskItemData` update for `set_task_status`.
 */
export function applyOptimisticTaskStatus(
  data: TaskItemData,
  nextStatus: TaskItemData['status'],
): TaskItemData {
  return {
    ...data,
    assigneeIds: [...data.assigneeIds],
    imageUrls: [...data.imageUrls],
    status: nextStatus,
  };
}

/**
 * Appends a proof photo URL to a task's image list, enforcing the 3-photo maximum (`MAX_IMAGES_EXCEEDED`).
 */
export function appendTaskImageUrl(
  existing: string[],
  nextUrl: string,
): string[] {
  if (existing.length >= MAX_TASK_IMAGES) {
    throw new RoomApiError('MAX_IMAGES_EXCEEDED');
  }

  const trimmed = typeof nextUrl === 'string' ? nextUrl.trim() : '';
  if (!trimmed) {
    throw new RoomApiError('INVALID_INPUT', '图片地址无效');
  }

  return [...existing, trimmed];
}

/**
 * Removes only the matching `targetUrl` from a task's image list without mutating the original array.
 */
export function removeTaskImageUrl(
  existing: string[],
  targetUrl: string,
): string[] {
  return existing.filter((url) => url !== targetUrl);
}

/**
 * Computes total and per-status counts across task items in a block.
 */
export function computeTaskCompletionStats(
  items: ReadonlyArray<{ data: TaskItemData }>,
): TaskCompletionStats {
  let done = 0;
  let inProgress = 0;
  let unclaimed = 0;

  for (const item of items) {
    switch (item.data.status) {
      case 'done':
        done += 1;
        break;
      case 'in_progress':
        inProgress += 1;
        break;
      case 'unclaimed':
        unclaimed += 1;
        break;
    }
  }

  return {
    total: items.length,
    done,
    inProgress,
    unclaimed,
  };
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Parses an optional task due date input (`YYYY-MM-DD`, `YYYY-MM-DD HH:mm`, or ISO string) into an ISO string.
 * Empty strings resolve to `null`.
 */
export function parseTaskDueAtInput(raw: string): string | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) {
    return null;
  }

  const dateOnlyMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const parsed = new Date(year, month - 1, day, 23, 59, 0, 0);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new RoomApiError('INVALID_INPUT', '截止日期无效，请检查年月日是否正确');
    }
    return parsed.toISOString();
  }

  const dateTimeMatch =
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
      trimmed,
    );
  if (dateTimeMatch) {
    const year = Number(dateTimeMatch[1]);
    const month = Number(dateTimeMatch[2]);
    const day = Number(dateTimeMatch[3]);
    const hour = Number(dateTimeMatch[4]);
    const minute = Number(dateTimeMatch[5]);
    const second = dateTimeMatch[6] ? Number(dateTimeMatch[6]) : 0;
    const parsed = new Date(year, month - 1, day, hour, minute, second, 0);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day ||
      parsed.getHours() !== hour ||
      parsed.getMinutes() !== minute ||
      parsed.getSeconds() !== second
    ) {
      throw new RoomApiError(
        'INVALID_INPUT',
        '截止时间格式无效，请使用 YYYY-MM-DD HH:mm',
      );
    }
    return parsed.toISOString();
  }

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    throw new RoomApiError(
      'INVALID_INPUT',
      '截止时间格式无效，请使用 YYYY-MM-DD 或 YYYY-MM-DD HH:mm',
    );
  }
  return new Date(ms).toISOString();
}

/**
 * Formats an ISO `dueAt` string into a concise Chinese label (`MM/DD` or `MM/DD HH:mm`).
 */
export function formatTaskDueAtLabel(dueAt: string | null): string | null {
  if (!dueAt) {
    return null;
  }
  const ms = Date.parse(dueAt);
  if (Number.isNaN(ms)) {
    return null;
  }
  const d = new Date(ms);
  const monthDay = `${d.getMonth() + 1}/${d.getDate()}`;
  const hours = d.getHours();
  const minutes = d.getMinutes();
  if ((hours === 0 && minutes === 0) || (hours === 23 && minutes === 59)) {
    return monthDay;
  }
  return `${monthDay} ${padTwo(hours)}:${padTwo(minutes)}`;
}

/**
 * Formats an ISO `dueAt` value back into an editable local `YYYY-MM-DD` or `YYYY-MM-DD HH:mm` string.
 */
export function formatDueAtForInput(dueAt: string | null): string {
  if (!dueAt) {
    return '';
  }
  const ms = Date.parse(dueAt);
  if (Number.isNaN(ms)) {
    return '';
  }
  const d = new Date(ms);
  const datePart = `${d.getFullYear()}-${padTwo(d.getMonth() + 1)}-${padTwo(d.getDate())}`;
  const hours = d.getHours();
  const minutes = d.getMinutes();
  if ((hours === 0 && minutes === 0) || (hours === 23 && minutes === 59)) {
    return datePart;
  }
  return `${datePart} ${padTwo(hours)}:${padTwo(minutes)}`;
}

/**
 * Formats an ISO timestamp for comment rows (`MM/DD HH:mm`).
 */
export function formatCommentTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return '';
  }
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${padTwo(d.getHours())}:${padTwo(d.getMinutes())}`;
}

/**
 * Immutably updates a task item's `data` inside the cached `ParsedBlock[]` list.
 */
export function updateTaskItemDataInBlocks(
  blocks: ParsedBlock[],
  blockId: string,
  itemId: string,
  updater: (data: TaskItemData) => TaskItemData,
): ParsedBlock[] {
  return blocks.map((block) => {
    if (block.id !== blockId || block.type !== 'task') {
      return block;
    }
    return {
      ...block,
      items: block.items.map((item) =>
        item.id === itemId ? { ...item, data: updater(item.data) } : item,
      ),
    };
  });
}

/**
 * Immutably replaces a task item inside the cached `ParsedBlock[]` list with its authoritative server record.
 */
export function replaceTaskItemInBlocks(
  blocks: ParsedBlock[],
  blockId: string,
  updatedItem: ParsedBlockItem<'task'>,
): ParsedBlock[] {
  return blocks.map((block) => {
    if (block.id !== blockId || block.type !== 'task') {
      return block;
    }
    return {
      ...block,
      items: block.items.map((item) =>
        item.id === updatedItem.id ? updatedItem : item,
      ),
    };
  });
}
