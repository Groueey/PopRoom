import type { ParsedBlockItem } from '../api/blockHelpers';
import type { PollTally, PollTimeSlot } from '../schemas/blocks';

/** Ordered default time-of-day periods used in availability heatmaps. */
export const DEFAULT_POLL_TIME_SLOTS: readonly PollTimeSlot[] = [
  'morning',
  'afternoon',
  'evening',
];

/** Human-readable Chinese labels for availability heatmap time slots. */
export const POLL_TIME_SLOT_LABELS: Record<PollTimeSlot, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
};

/** Single cell in an availability heatmap matrix (`date × timeSlot`). */
export interface AvailabilityCell {
  date: string;
  slot: PollTimeSlot;
  item: ParsedBlockItem<'poll'> | null;
  itemId: string | null;
  voteCount: number;
  myVoted: boolean;
  ratio: number;
  isTop: boolean;
}

/** Computed heatmap cells along with peak vote metadata. */
export interface AvailabilityMatrixResult {
  cells: AvailabilityCell[];
  maxVotes: number;
  topItemIds: string[];
}

function addUniqueVoterId(
  voterIds: readonly string[],
  userId: string,
): string[] {
  if (!userId) {
    return [...voterIds];
  }
  return voterIds.includes(userId) ? [...voterIds] : [...voterIds, userId];
}

function removeVoterId(
  voterIds: readonly string[],
  userId: string,
): string[] {
  if (!userId) {
    return [...voterIds];
  }
  return voterIds.filter((id) => id !== userId);
}

/**
 * Computes an immutable optimistic update for `tallies` when toggling a user's vote
 * on `itemId` inside `blockId`, respecting single-choice exclusivity and anonymous masking.
 */
export function applyOptimisticPollToggle(
  tallies: PollTally[],
  itemId: string,
  blockId: string,
  multiple: boolean,
  currentUserId: string,
  anonymous: boolean,
): PollTally[] {
  const existingTarget = tallies.find((tally) => tally.item_id === itemId);
  const targetWasVoted = existingTarget?.my_voted ?? false;
  const shouldClearOtherVotesInBlock = !multiple && !targetWasVoted;

  const nextTallies: PollTally[] = tallies.map((tally) => {
    if (tally.item_id === itemId) {
      if (targetWasVoted) {
        return {
          ...tally,
          vote_count: Math.max(0, tally.vote_count - 1),
          my_voted: false,
          voter_ids: anonymous
            ? []
            : removeVoterId(tally.voter_ids, currentUserId),
        };
      }
      return {
        ...tally,
        vote_count: tally.vote_count + 1,
        my_voted: true,
        voter_ids: anonymous
          ? []
          : addUniqueVoterId(tally.voter_ids, currentUserId),
      };
    }

    if (
      shouldClearOtherVotesInBlock &&
      tally.block_id === blockId &&
      tally.my_voted
    ) {
      return {
        ...tally,
        vote_count: Math.max(0, tally.vote_count - 1),
        my_voted: false,
        voter_ids: anonymous
          ? []
          : removeVoterId(tally.voter_ids, currentUserId),
      };
    }

    return tally;
  });

  if (!existingTarget) {
    nextTallies.push({
      item_id: itemId,
      block_id: blockId,
      vote_count: 1,
      my_voted: true,
      voter_ids: anonymous || !currentUserId ? [] : [currentUserId],
    });
  }

  return nextTallies;
}

/**
 * Sanitizes a `PollTally` before UI rendering so anonymous polls never expose `voter_ids`,
 * even if stale or unmasked entries exist in local query cache (Review Focus #3).
 */
export function sanitizePollTallyForDisplay(
  tally: PollTally,
  anonymous: boolean,
): PollTally {
  if (anonymous) {
    return {
      ...tally,
      voter_ids: [],
    };
  }
  return {
    ...tally,
    voter_ids: [...tally.voter_ids],
  };
}

/**
 * Builds an availability heatmap matrix (`dates × slots`), scaling vote ratio against
 * `totalActiveMembers` and marking all items tied for `maxVotes > 0` as top slots.
 */
export function buildAvailabilityMatrix(
  dates: string[],
  slots: ('morning' | 'afternoon' | 'evening')[],
  items: ParsedBlockItem<'poll'>[],
  tallies: Map<string, PollTally>,
  totalActiveMembers: number,
): AvailabilityMatrixResult {
  const itemByKey = new Map<string, ParsedBlockItem<'poll'>>();
  for (const item of items) {
    if (item.data.slotDate && item.data.slotPeriod) {
      itemByKey.set(`${item.data.slotDate}::${item.data.slotPeriod}`, item);
    }
  }

  let maxVotes = 0;
  const draftCells: Omit<AvailabilityCell, 'isTop'>[] = [];

  for (const date of dates) {
    for (const slot of slots) {
      const matchedItem = itemByKey.get(`${date}::${slot}`) ?? null;
      const tally = matchedItem ? tallies.get(matchedItem.id) : undefined;
      const voteCount = tally?.vote_count ?? 0;
      const myVoted = tally?.my_voted ?? false;
      const ratio =
        totalActiveMembers > 0
          ? Math.min(1, Math.max(0, voteCount / totalActiveMembers))
          : 0;

      if (matchedItem && voteCount > maxVotes) {
        maxVotes = voteCount;
      }

      draftCells.push({
        date,
        slot,
        item: matchedItem,
        itemId: matchedItem?.id ?? null,
        voteCount,
        myVoted,
        ratio,
      });
    }
  }

  const topItemIds: string[] = [];
  const seenTopIds = new Set<string>();
  const cells: AvailabilityCell[] = draftCells.map((cell) => {
    const isTop =
      maxVotes > 0 && cell.itemId !== null && cell.voteCount === maxVotes;
    if (isTop && cell.itemId && !seenTopIds.has(cell.itemId)) {
      seenTopIds.add(cell.itemId);
      topItemIds.push(cell.itemId);
    }
    return {
      ...cell,
      isTop,
    };
  });

  return {
    cells,
    maxVotes,
    topItemIds,
  };
}

/**
 * Merges configured `candidateDates` and any `slotDate` present on poll items into
 * a deduplicated, chronologically sorted list of date strings.
 */
export function collectAvailabilityDates(
  configDates: readonly string[] | undefined,
  items: readonly ParsedBlockItem<'poll'>[],
): string[] {
  const dateSet = new Set<string>();
  for (const rawDate of configDates ?? []) {
    const trimmed = rawDate.trim();
    if (trimmed) {
      dateSet.add(trimmed);
    }
  }
  for (const item of items) {
    const trimmed = item.data.slotDate?.trim();
    if (trimmed) {
      dateSet.add(trimmed);
    }
  }
  return Array.from(dateSet).sort((a, b) => a.localeCompare(b));
}

/** Maps a `0..1` availability ratio to one of 5 tangerine heatmap intensity tiers (`0..4`). */
export function getHeatmapTier(ratio: number): 0 | 1 | 2 | 3 | 4 {
  if (ratio <= 0) {
    return 0;
  }
  if (ratio <= 0.25) {
    return 1;
  }
  if (ratio <= 0.5) {
    return 2;
  }
  if (ratio <= 0.75) {
    return 3;
  }
  return 4;
}

/** Computes a rounded integer percentage (`0..100`) for option voting progress bars. */
export function formatPollPercentage(
  voteCount: number,
  totalVotes: number,
): number {
  if (totalVotes <= 0 || voteCount <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((voteCount / totalVotes) * 100));
}

/** Returns whether a poll deadline ISO string has elapsed relative to `nowMs`. */
export function isPollExpired(
  deadline: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!deadline) {
    return false;
  }
  const deadlineMs = Date.parse(deadline);
  if (Number.isNaN(deadlineMs)) {
    return false;
  }
  return deadlineMs < nowMs;
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function parseLocalCalendarDate(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/** Validates whether a string is a real `YYYY-MM-DD` calendar date. */
export function isValidCalendarDate(dateStr: string): boolean {
  return parseLocalCalendarDate(dateStr) !== null;
}

/** Formats a `YYYY-MM-DD` string into compact Chinese display parts (`MM/DD` + weekday). */
export function formatAvailabilityDateLabel(dateStr: string): {
  shortDate: string;
  weekday: string;
} {
  const parsed = parseLocalCalendarDate(dateStr);
  if (!parsed) {
    return { shortDate: dateStr, weekday: '' };
  }
  const month = parsed.getMonth() + 1;
  const day = parsed.getDate();
  const weekday = WEEKDAY_LABELS[parsed.getDay()] ?? '';
  return {
    shortDate: `${month}/${day}`,
    weekday,
  };
}

/** Generates `count` consecutive local `YYYY-MM-DD` date strings starting from `fromDate`. */
export function getUpcomingDateStrings(
  count: number = 4,
  fromDate: Date = new Date(),
): string[] {
  const result: string[] = [];
  const base = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate(),
  );
  for (let i = 0; i < count; i += 1) {
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const yyyy = next.getFullYear();
    const mm = String(next.getMonth() + 1).padStart(2, '0');
    const dd = String(next.getDate()).padStart(2, '0');
    result.push(`${yyyy}-${mm}-${dd}`);
  }
  return result;
}
