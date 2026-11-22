import type { ParsedBlockItem } from '../api/blockHelpers';

/** Fallback group heading when a schedule item has an empty `groupLabel`. */
export const DEFAULT_SCHEDULE_GROUP_LABEL = '活动当天';

/** Ordered timeline section grouping schedule items under a shared `groupLabel`. */
export interface ScheduleGroup {
  groupLabel: string;
  items: ParsedBlockItem<'schedule'>[];
}

type ParsedScheduleTime =
  | { kind: 'tod'; secondsOfDay: number }
  | { kind: 'epoch'; ms: number; secondsOfDay: number }
  | { kind: 'raw'; text: string };

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

function parseTimeOfDay(trimmed: string): ParsedScheduleTime | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }
  return {
    kind: 'tod',
    secondsOfDay: hours * 3600 + minutes * 60 + seconds,
  };
}

function parseDateTimeOrIso(trimmed: string): ParsedScheduleTime | null {
  const localDateTimeMatch =
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
      trimmed,
    );
  if (localDateTimeMatch) {
    const year = Number(localDateTimeMatch[1]);
    const month = Number(localDateTimeMatch[2]);
    const day = Number(localDateTimeMatch[3]);
    const hour = Number(localDateTimeMatch[4]);
    const minute = Number(localDateTimeMatch[5]);
    const second = localDateTimeMatch[6] ? Number(localDateTimeMatch[6]) : 0;
    const parsed = new Date(year, month - 1, day, hour, minute, second, 0);
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day ||
      parsed.getHours() !== hour ||
      parsed.getMinutes() !== minute ||
      parsed.getSeconds() !== second
    ) {
      return null;
    }
    return {
      kind: 'epoch',
      ms: parsed.getTime(),
      secondsOfDay: hour * 3600 + minute * 60 + second,
    };
  }

  if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmed)) {
    return null;
  }

  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    return null;
  }
  const d = new Date(ms);
  return {
    kind: 'epoch',
    ms,
    secondsOfDay: d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(),
  };
}

function parseScheduleTimeKey(raw: string): ParsedScheduleTime {
  const trimmed = raw.trim();
  const tod = parseTimeOfDay(trimmed);
  if (tod) {
    return tod;
  }
  const epoch = parseDateTimeOrIso(trimmed);
  if (epoch) {
    return epoch;
  }
  return { kind: 'raw', text: trimmed };
}

function compareParsedScheduleTimes(
  a: ParsedScheduleTime,
  b: ParsedScheduleTime,
): number {
  if (a.kind === 'epoch' && b.kind === 'epoch') {
    return a.ms - b.ms;
  }
  if (a.kind !== 'raw' && b.kind !== 'raw') {
    return a.secondsOfDay - b.secondsOfDay;
  }
  if (a.kind !== 'raw' && b.kind === 'raw') {
    return -1;
  }
  if (a.kind === 'raw' && b.kind !== 'raw') {
    return 1;
  }
  return 0;
}

function compareScheduleItems(
  a: ParsedBlockItem<'schedule'>,
  b: ParsedBlockItem<'schedule'>,
): number {
  const timeDiff = compareParsedScheduleTimes(
    parseScheduleTimeKey(a.data.startTime),
    parseScheduleTimeKey(b.data.startTime),
  );
  if (timeDiff !== 0) {
    return timeDiff;
  }
  if (a.sort_order !== b.sort_order) {
    return a.sort_order - b.sort_order;
  }
  const createdA = Date.parse(a.created_at);
  const createdB = Date.parse(b.created_at);
  if (
    !Number.isNaN(createdA) &&
    !Number.isNaN(createdB) &&
    createdA !== createdB
  ) {
    return createdA - createdB;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Groups schedule items by trimmed `groupLabel` (preserving first-seen group order and
 * falling back to `"活动当天"` when empty) and sorts items inside each group ascending
 * by `startTime` (`HH:mm` or ISO timestamp) with `sort_order` as tie-breaker.
 */
export function groupAndSortScheduleItems(
  items: ParsedBlockItem<'schedule'>[],
): ScheduleGroup[] {
  const grouped = new Map<string, ParsedBlockItem<'schedule'>[]>();

  for (const item of items) {
    const label = item.data.groupLabel.trim() || DEFAULT_SCHEDULE_GROUP_LABEL;
    const bucket = grouped.get(label);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(label, [item]);
    }
  }

  const result: ScheduleGroup[] = [];
  for (const [groupLabel, bucket] of grouped.entries()) {
    result.push({
      groupLabel,
      items: bucket.slice().sort(compareScheduleItems),
    });
  }
  return result;
}

/**
 * Validates and normalizes user-entered schedule time (`HH:mm` or ISO date/time string).
 * Returns normalized `HH:mm` / trimmed ISO string, or `null` when invalid.
 */
export function normalizeScheduleTimeInput(raw: string): string | null {
  const trimmed = raw.replace(/：/g, ':').trim();
  if (!trimmed) {
    return null;
  }

  const todMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (todMatch) {
    const hours = Number(todMatch[1]);
    const minutes = Number(todMatch[2]);
    const seconds = todMatch[3] ? Number(todMatch[3]) : 0;
    if (
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59 ||
      seconds < 0 ||
      seconds > 59
    ) {
      return null;
    }
    return `${padTwo(hours)}:${padTwo(minutes)}`;
  }

  const parsedEpoch = parseDateTimeOrIso(trimmed);
  if (parsedEpoch && parsedEpoch.kind === 'epoch') {
    return trimmed;
  }

  return null;
}

/** Formats a stored `startTime` or `endTime` (`HH:mm` or ISO string) as concise `HH:mm`. */
export function formatScheduleTimeDisplay(raw: string): string {
  const parsed = parseScheduleTimeKey(raw);
  if (parsed.kind === 'tod') {
    const hours = Math.floor(parsed.secondsOfDay / 3600);
    const minutes = Math.floor((parsed.secondsOfDay % 3600) / 60);
    return `${padTwo(hours)}:${padTwo(minutes)}`;
  }
  if (parsed.kind === 'epoch') {
    const d = new Date(parsed.ms);
    return `${padTwo(d.getHours())}:${padTwo(d.getMinutes())}`;
  }
  return raw.trim();
}

/** Formats a schedule item's start and optional end time into a display string. */
export function formatScheduleTimeRange(
  startTime: string,
  endTime?: string,
): string {
  const startLabel = formatScheduleTimeDisplay(startTime);
  const trimmedEnd = endTime?.trim();
  if (!trimmedEnd) {
    return startLabel;
  }
  const endLabel = formatScheduleTimeDisplay(trimmedEnd);
  return endLabel ? `${startLabel} - ${endLabel}` : startLabel;
}
