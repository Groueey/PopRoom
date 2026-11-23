import { isValidRoomCode, normalizeRoomCode } from '../lib/roomCode';
import type {
  JoinMode,
  MemberRole,
  RoomRow,
  TemplateType,
} from '../types/database';

/** Maximum character length (Unicode code points) allowed for room titles. */
export const MAX_ROOM_TITLE_LENGTH = 40;

const VALID_TEMPLATE_TYPES: readonly TemplateType[] = [
  'campus',
  'travel',
  'party',
  'custom',
];

const VALID_JOIN_MODES: readonly JoinMode[] = ['passcode', 'approval'];

/** Domain error codes emitted by room API helpers and PostgreSQL RPCs. */
export type RoomErrorCode =
  | 'INVALID_ROOM_CODE'
  | 'INVALID_INPUT'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_ARCHIVED'
  | 'USER_KICKED'
  | 'FORBIDDEN'
  | 'NOT_AUTHENTICATED'
  | 'PROFILE_REQUIRED'
  | 'NOT_A_MEMBER'
  | 'ROOM_CODE_GENERATION_FAILED'
  | 'ITEM_NOT_FOUND'
  | 'POLL_LOCKED'
  | 'POLL_EXPIRED'
  | 'MAX_IMAGES_EXCEEDED'
  | 'LOG_ALREADY_RESTORED'
  | 'CHAT_DISABLED'
  | 'HOST_CANNOT_LEAVE'
  | 'CANNOT_BLOCK_SELF'
  | 'SCHEMA_OUTDATED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

/** Typed domain error wrapping room validation, RPC, and RLS failures. */
export class RoomApiError extends Error {
  public readonly code: RoomErrorCode;

  constructor(code: RoomErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RoomApiError';
    this.code = code;
    Object.setPrototypeOf(this, RoomApiError.prototype);
  }
}

const ROOM_ERROR_MESSAGES: Record<RoomErrorCode, string> = {
  INVALID_ROOM_CODE: '请输入有效的 6 位房间码（仅含字母与数字，不含 0/O/1/I）',
  INVALID_INPUT: '输入信息有误，请检查后重试',
  ROOM_NOT_FOUND: '房间不存在或房间码已失效',
  ROOM_ARCHIVED: '该活动已归档，当前仅支持只读查看与导出',
  USER_KICKED: '你已被移出该房间，无法再次加入',
  FORBIDDEN: '你没有权限执行该操作',
  NOT_AUTHENTICATED: '登录状态已失效，请重新登录',
  PROFILE_REQUIRED: '请先完善个人昵称和头像设置',
  NOT_A_MEMBER: '你还不是该房间的活跃成员',
  ROOM_CODE_GENERATION_FAILED: '生成房间码失败，请稍后重试',
  ITEM_NOT_FOUND: '目标记录不存在或已被删除',
  POLL_LOCKED: '该投票已被房主锁定，无法更改',
  POLL_EXPIRED: '该投票已过截止时间',
  MAX_IMAGES_EXCEEDED: '最多只能上传 3 张图片',
  LOG_ALREADY_RESTORED: '该条目已恢复，无需重复操作',
  CHAT_DISABLED: '该房间未开启聊天室',
  HOST_CANNOT_LEAVE: '房主无法直接退出房间，你可以选择归档活动',
  CANNOT_BLOCK_SELF: '不能屏蔽自己',
  SCHEMA_OUTDATED:
    '后端数据库尚未执行最新迁移脚本（004 / 005 / 006），请在 Supabase SQL Editor 执行后重试',
  NETWORK_ERROR: '网络连接异常，请检查网络后重试',
  UNKNOWN_ERROR: '操作失败，请稍后重试',
};

const ERROR_TOKEN_RULES: ReadonlyArray<readonly [string, RoomErrorCode]> = [
  ['INVALID_ROOM_CODE', 'INVALID_ROOM_CODE'],
  ['ROOM_NOT_FOUND', 'ROOM_NOT_FOUND'],
  ['ROOM_ARCHIVED', 'ROOM_ARCHIVED'],
  ['USER_KICKED', 'USER_KICKED'],
  ['FORBIDDEN', 'FORBIDDEN'],
  ['NOT_AUTHENTICATED', 'NOT_AUTHENTICATED'],
  ['PROFILE_REQUIRED', 'PROFILE_REQUIRED'],
  ['NOT_A_MEMBER', 'NOT_A_MEMBER'],
  ['ROOM_CODE_GENERATION_FAILED', 'ROOM_CODE_GENERATION_FAILED'],
  ['ITEM_NOT_FOUND', 'ITEM_NOT_FOUND'],
  ['POLL_LOCKED', 'POLL_LOCKED'],
  ['POLL_EXPIRED', 'POLL_EXPIRED'],
  ['MAX_IMAGES_EXCEEDED', 'MAX_IMAGES_EXCEEDED'],
  ['LOG_ALREADY_RESTORED', 'LOG_ALREADY_RESTORED'],
  ['CHAT_DISABLED', 'CHAT_DISABLED'],
  ['HOST_CANNOT_LEAVE', 'HOST_CANNOT_LEAVE'],
  ['CANNOT_BLOCK_SELF', 'CANNOT_BLOCK_SELF'],
  ['PGRST202', 'SCHEMA_OUTDATED'],
  ['PGRST205', 'SCHEMA_OUTDATED'],
  ['42883', 'SCHEMA_OUTDATED'],
  ['42P01', 'SCHEMA_OUTDATED'],
  ['42703', 'SCHEMA_OUTDATED'],
  ['schema cache', 'SCHEMA_OUTDATED'],
  ['INVALID_INPUT', 'INVALID_INPUT'],
  ['PGRST116', 'ROOM_NOT_FOUND'],
  ['42501', 'FORBIDDEN'],
];

function extractErrorText(err: unknown): string {
  if (typeof err === 'string') {
    return err;
  }
  if (!err || typeof err !== 'object') {
    return '';
  }
  const parts: string[] = [];
  const record = err as Record<string, unknown>;
  for (const key of ['code', 'message', 'details', 'hint'] as const) {
    const val = record[key];
    if (typeof val === 'string' && val.trim()) {
      parts.push(val.trim());
    }
  }
  return parts.join(' ');
}

/** Identifies the normalized `RoomErrorCode` from a Postgres, PostgREST, or JS error. */
export function detectRoomErrorCode(err: unknown): RoomErrorCode {
  if (err instanceof RoomApiError) {
    return err.code;
  }

  const rawText = extractErrorText(err);
  if (!rawText) {
    return 'UNKNOWN_ERROR';
  }

  for (const [token, code] of ERROR_TOKEN_RULES) {
    if (rawText.includes(token)) {
      return code;
    }
  }

  if (/row-level security/i.test(rawText)) {
    return 'FORBIDDEN';
  }

  if (/network|failed to fetch|network request failed|timeout|econnrefused/i.test(rawText)) {
    return 'NETWORK_ERROR';
  }

  return 'UNKNOWN_ERROR';
}

/** Maps Postgres/Supabase and validation errors into crisp Chinese user-facing messages. */
export function mapRoomError(err: unknown): string {
  if (err instanceof RoomApiError) {
    if (
      err.code === 'INVALID_INPUT' &&
      err.message &&
      err.message !== 'INVALID_INPUT' &&
      !err.message.startsWith('INVALID_INPUT:')
    ) {
      return err.message;
    }
    return ROOM_ERROR_MESSAGES[err.code];
  }

  const code = detectRoomErrorCode(err);
  return ROOM_ERROR_MESSAGES[code];
}

/** Converts an unknown thrown/returned error into a `RoomApiError`. */
export function toRoomApiError(err: unknown): RoomApiError {
  if (err instanceof RoomApiError) {
    return err;
  }
  const code = detectRoomErrorCode(err);
  if (code === 'UNKNOWN_ERROR' && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[PopRoom] Unmapped Supabase/API error:', err);
  }
  return new RoomApiError(code, mapRoomError(err));
}

function parseOptionalDateInput(raw?: string | null): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const dateOnlyMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new RoomApiError('INVALID_INPUT', '活动日期无效，请检查年月日是否正确');
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
        '活动时间格式无效，请使用 YYYY-MM-DD HH:mm',
      );
    }
    return parsed.toISOString();
  }

  const timestampMs = Date.parse(trimmed);
  if (Number.isNaN(timestampMs)) {
    throw new RoomApiError(
      'INVALID_INPUT',
      '活动时间格式无效，请使用 YYYY-MM-DD 或 YYYY-MM-DD HH:mm',
    );
  }
  return new Date(timestampMs).toISOString();
}

function validateRoomTitle(rawTitle: unknown): string {
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (!title) {
    throw new RoomApiError('INVALID_INPUT', '请输入活动房间名称');
  }
  if (Array.from(title).length > MAX_ROOM_TITLE_LENGTH) {
    throw new RoomApiError(
      'INVALID_INPUT',
      `房间名称不能超过 ${MAX_ROOM_TITLE_LENGTH} 个字`,
    );
  }
  return title;
}

/** Form payload accepted by `createRoomWithTemplate`. */
export interface CreateRoomInput {
  title: string;
  templateType: TemplateType;
  joinMode: JoinMode;
  announcement?: string;
  eventStartAt?: string | null;
  eventEndAt?: string | null;
  chatEnabled?: boolean;
}

/** Validated and normalized room creation payload ready for `create_room_with_template`. */
export interface ValidatedCreateRoomInput {
  title: string;
  templateType: TemplateType;
  joinMode: JoinMode;
  announcement: string;
  eventStartAt: string | null;
  eventEndAt: string | null;
  chatEnabled?: boolean;
}

/** Validates and normalizes room creation input before invoking the RPC. */
export function validateCreateRoomInput(
  input: CreateRoomInput,
): ValidatedCreateRoomInput {
  const title = validateRoomTitle(input.title);

  if (!VALID_TEMPLATE_TYPES.includes(input.templateType)) {
    throw new RoomApiError('INVALID_INPUT', '请选择有效的活动模板');
  }

  if (!VALID_JOIN_MODES.includes(input.joinMode)) {
    throw new RoomApiError('INVALID_INPUT', '请选择有效的进房方式');
  }

  const announcement =
    typeof input.announcement === 'string' ? input.announcement.trim() : '';
  const eventStartAt = parseOptionalDateInput(input.eventStartAt);
  const eventEndAt = parseOptionalDateInput(input.eventEndAt);

  if (
    eventStartAt &&
    eventEndAt &&
    Date.parse(eventEndAt) < Date.parse(eventStartAt)
  ) {
    throw new RoomApiError('INVALID_INPUT', '结束时间不能早于开始时间');
  }

  return {
    title,
    templateType: input.templateType,
    joinMode: input.joinMode,
    announcement,
    eventStartAt,
    eventEndAt,
    ...(input.chatEnabled !== undefined
      ? { chatEnabled: Boolean(input.chatEnabled) }
      : {}),
  };
}

/** Partial metadata patch accepted by `updateRoomMetadata`. */
export interface UpdateRoomMetadataInput {
  title?: string;
  announcement?: string;
  join_mode?: JoinMode;
  allow_member_create_poll?: boolean;
  chat_enabled?: boolean;
  event_start_at?: string | null;
  event_end_at?: string | null;
}

/** Validates partial room settings updates before sending PostgREST `UPDATE`. */
export function validateUpdateRoomMetadataInput(
  input: UpdateRoomMetadataInput,
): UpdateRoomMetadataInput {
  const patch: UpdateRoomMetadataInput = {};

  if (input.title !== undefined) {
    patch.title = validateRoomTitle(input.title);
  }
  if (input.announcement !== undefined) {
    patch.announcement = input.announcement.trim();
  }
  if (input.join_mode !== undefined) {
    if (!VALID_JOIN_MODES.includes(input.join_mode)) {
      throw new RoomApiError('INVALID_INPUT', '请选择有效的进房方式');
    }
    patch.join_mode = input.join_mode;
  }
  if (input.allow_member_create_poll !== undefined) {
    patch.allow_member_create_poll = Boolean(input.allow_member_create_poll);
  }
  if (input.chat_enabled !== undefined) {
    patch.chat_enabled = Boolean(input.chat_enabled);
  }
  if (input.event_start_at !== undefined) {
    patch.event_start_at = parseOptionalDateInput(input.event_start_at);
  }
  if (input.event_end_at !== undefined) {
    patch.event_end_at = parseOptionalDateInput(input.event_end_at);
  }

  if (
    patch.event_start_at &&
    patch.event_end_at &&
    Date.parse(patch.event_end_at) < Date.parse(patch.event_start_at)
  ) {
    throw new RoomApiError('INVALID_INPUT', '活动结束时间不能早于开始时间');
  }

  return patch;
}

/** RPC argument payload for `join_room_by_code`. */
export interface JoinRoomPayload {
  p_room_code: string;
  p_apply_note: string | null;
}

/** Normalizes and validates raw 6-char room code input and optional join note. */
export function prepareJoinPayload(
  rawCode: string,
  applyNote?: string,
): JoinRoomPayload {
  const normalized = normalizeRoomCode(typeof rawCode === 'string' ? rawCode : '');
  if (!isValidRoomCode(normalized)) {
    throw new RoomApiError(
      'INVALID_ROOM_CODE',
      'INVALID_ROOM_CODE: 请输入有效的 6 位房间码（不含 0/O/1/I）',
    );
  }

  const trimmedNote = typeof applyNote === 'string' ? applyNote.trim() : '';
  return {
    p_room_code: normalized,
    p_apply_note: trimmedNote.length > 0 ? trimmedNote : null,
  };
}

/** Lobby room summary pairing a `RoomRow` with current user's role and active member count. */
export interface LobbyRoomSummary {
  room: RoomRow;
  myRole: MemberRole;
  memberCount: number;
}

/** Grouped active and archived rooms returned by `fetchMyRooms`. */
export interface MyRoomsResult {
  active: LobbyRoomSummary[];
  archived: LobbyRoomSummary[];
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

function formatShortDateTime(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return null;
  }
  const date = new Date(ms);
  const monthDay = `${date.getMonth() + 1}/${date.getDate()}`;
  const hours = date.getHours();
  const minutes = date.getMinutes();
  if (hours === 0 && minutes === 0) {
    return monthDay;
  }
  return `${monthDay} ${padTwo(hours)}:${padTwo(minutes)}`;
}

/** Human-readable Chinese role labels for room member badges. */
export const ROLE_LABELS: Record<MemberRole, string> = {
  host: '房主',
  admin: '管理员',
  member: '成员',
};

/** Human-readable Chinese gate mode labels for room entry cards and editors. */
export const JOIN_MODE_LABELS: Record<JoinMode, string> = {
  passcode: '凭码直进',
  approval: '凭码申请审批',
};

/** Formats optional room start/end timestamps into a compact Chinese display range. */
export function formatRoomEventWindow(
  startAt: string | null,
  endAt: string | null,
): string | null {
  const startLabel = startAt ? formatShortDateTime(startAt) : null;
  const endLabel = endAt ? formatShortDateTime(endAt) : null;
  if (startLabel && endLabel) {
    return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
  }
  if (startLabel) {
    return `${startLabel} 开始`;
  }
  if (endLabel) {
    return `截止 ${endLabel}`;
  }
  return null;
}
