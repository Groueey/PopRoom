import type { ParsedBlock } from '../api/blocks';
import type { ParsedRoomMessage } from './chatHelpers';
import {
  buildAvailabilityMatrix,
  collectAvailabilityDates,
  DEFAULT_POLL_TIME_SLOTS,
  formatAvailabilityDateLabel,
  formatPollPercentage,
  POLL_TIME_SLOT_LABELS,
} from './pollHelpers';
import {
  formatScheduleTimeRange,
  groupAndSortScheduleItems,
} from './scheduleHelpers';
import { computeMinimalTransfers, formatCents } from './splitAlgorithm';
import { computeTaskCompletionStats } from './taskHelpers';
import type { PollTally, TaskStatus } from '../schemas/blocks';

/** Compact preview payloads displayed inside the Overview conclusion stream. */
export type BlockOverviewPreview =
  | {
      kind: 'poll_options';
      options: Array<{
        id: string;
        label: string;
        votes: number;
        percent: number;
        myVoted: boolean;
      }>;
      remainingCount: number;
    }
  | {
      kind: 'poll_slots';
      slots: Array<{
        id: string;
        label: string;
        votes: number;
      }>;
    }
  | {
      kind: 'tasks';
      items: Array<{
        id: string;
        title: string;
        status: TaskStatus;
      }>;
      remainingCount: number;
    }
  | {
      kind: 'schedule';
      nodes: Array<{
        id: string;
        time: string;
        title: string;
        location?: string;
      }>;
      remainingCount: number;
    }
  | {
      kind: 'expense_transfers';
      transfers: Array<{
        fromUserId: string;
        toUserId: string;
        amountText: string;
      }>;
      remainingCount: number;
    };

/** Concise display metadata for a block in the horizontal pill rail and overview list. */
export interface BlockOverviewSummary {
  blockId: string;
  pillText: string;
  statText: string;
  conclusion: string;
  /** Optional 0–100 completion or budget ratio for rendering an inline slim progress bar. */
  progressPercent?: number;
  isAlert?: boolean;
  preview?: BlockOverviewPreview;
}

/** Actionable nudge rendered in the Overview "needs your attention" banner. */
export interface BoardPendingAction {
  id: string;
  kind: 'poll' | 'task';
  blockId: string;
  text: string;
  ctaLabel: string;
}

function truncateText(value: string, maxChars: number): string {
  const chars = Array.from(value.trim());
  if (chars.length <= maxChars) {
    return chars.join('');
  }
  return `${chars.slice(0, maxChars - 1).join('')}…`;
}

/**
 * Builds concise pill-rail and overview conclusion metadata (with light snapshot previews)
 * for any collaborative block.
 */
export function buildBlockOverviewSummary(
  block: ParsedBlock,
  tallies: PollTally[] = [],
  totalActiveMembers = 1,
): BlockOverviewSummary {
  const shortTitle = truncateText(block.title, 7);

  switch (block.type) {
    case 'poll': {
      const tallyMap = new Map(tallies.map((t) => [t.item_id, t]));
      let totalVotes = 0;
      for (const item of block.items) {
        totalVotes += tallyMap.get(item.id)?.vote_count ?? 0;
      }

      if (block.config.mode === 'availability') {
        const activeSlots =
          block.config.timeSlots && block.config.timeSlots.length > 0
            ? [...block.config.timeSlots]
            : [...DEFAULT_POLL_TIME_SLOTS];
        const dates = collectAvailabilityDates(
          block.config.candidateDates,
          block.items,
        );
        const matrix = buildAvailabilityMatrix(
          dates,
          activeSlots,
          block.items,
          tallyMap,
          Math.max(1, totalActiveMembers),
        );

        let conclusion = '尚未设置候选日期与时段';
        const previewSlots: Array<{ id: string; label: string; votes: number }> =
          [];

        if (dates.length > 0 && matrix.topItemIds.length > 0) {
          for (const topId of matrix.topItemIds.slice(0, 2)) {
            const topItem = block.items.find((entry) => entry.id === topId);
            if (!topItem) {
              continue;
            }
            const label =
              topItem.data.slotDate && topItem.data.slotPeriod
                ? `${formatAvailabilityDateLabel(topItem.data.slotDate).shortDate} ${POLL_TIME_SLOT_LABELS[topItem.data.slotPeriod]}`
                : topItem.data.label;
            previewSlots.push({
              id: topItem.id,
              label,
              votes: matrix.maxVotes,
            });
          }
          const lead = previewSlots[0];
          conclusion = lead
            ? `最佳：${lead.label}（${lead.votes} 人有空）`
            : `${dates.length} 个候选日期`;
        } else if (dates.length > 0) {
          conclusion = `${dates.length} 个候选日期 · 等待成员打卡空闲时间`;
        }

        return {
          blockId: block.id,
          pillText: totalVotes > 0 ? `${shortTitle} · ${totalVotes}` : shortTitle,
          statText: `${totalVotes} 打卡`,
          conclusion,
          preview:
            previewSlots.length > 0
              ? { kind: 'poll_slots', slots: previewSlots }
              : undefined,
        };
      }

      const rankedOptions = block.items
        .map((item) => {
          const tally = tallyMap.get(item.id);
          const votes = tally?.vote_count ?? 0;
          return {
            id: item.id,
            label: item.data.label,
            votes,
            percent: formatPollPercentage(votes, totalVotes),
            myVoted: tally?.my_voted ?? false,
          };
        })
        .sort((a, b) => b.votes - a.votes);

      const topOption = rankedOptions[0];
      const conclusion =
        block.items.length === 0
          ? '暂无投票选项，点击补充方案'
          : topOption && topOption.votes > 0
            ? `领先：${topOption.label}（${topOption.votes} 票）`
            : `${block.items.length} 个候选项 · 等待投票`;

      const previewOptions = rankedOptions.slice(0, 2);

      return {
        blockId: block.id,
        pillText: totalVotes > 0 ? `${shortTitle} · ${totalVotes}票` : shortTitle,
        statText: `${totalVotes} 票`,
        conclusion,
        preview:
          previewOptions.length > 0
            ? {
                kind: 'poll_options',
                options: previewOptions,
                remainingCount: Math.max(
                  0,
                  rankedOptions.length - previewOptions.length,
                ),
              }
            : undefined,
      };
    }

    case 'task': {
      const stats = computeTaskCompletionStats(block.items);
      const pct =
        stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

      let conclusion = '暂无分工或物资条目';
      if (stats.total > 0) {
        if (stats.done === stats.total) {
          conclusion = `全部 ${stats.total} 项已完成`;
        } else if (stats.unclaimed > 0) {
          conclusion = `进行中 ${stats.inProgress} · 还有 ${stats.unclaimed} 项待认领`;
        } else {
          conclusion = `已全员认领 · 进行中 ${stats.inProgress} 项`;
        }
      }

      // Prioritize unclaimed -> in_progress -> done for actionable overview snapshot.
      const statusWeight: Record<TaskStatus, number> = {
        unclaimed: 0,
        in_progress: 1,
        done: 2,
      };
      const prioritized = [...block.items].sort(
        (a, b) => statusWeight[a.data.status] - statusWeight[b.data.status],
      );
      const previewItems = prioritized.slice(0, 2).map((item) => ({
        id: item.id,
        title: item.data.title,
        status: item.data.status,
      }));

      return {
        blockId: block.id,
        pillText:
          stats.total > 0
            ? `${shortTitle} ${stats.done}/${stats.total}`
            : shortTitle,
        statText: `${stats.done}/${stats.total} 完成`,
        conclusion,
        progressPercent: stats.total > 0 ? pct : undefined,
        preview:
          previewItems.length > 0
            ? {
                kind: 'tasks',
                items: previewItems,
                remainingCount: Math.max(
                  0,
                  block.items.length - previewItems.length,
                ),
              }
            : undefined,
      };
    }

    case 'schedule': {
      const groups = groupAndSortScheduleItems(block.items);
      const flattened = groups.flatMap((group) => group.items);
      const firstItem = flattened[0];
      let conclusion = '暂无日程安排，点击新增时间节点';
      let statText = '0 节点';

      if (firstItem) {
        const timeRange = formatScheduleTimeRange(
          firstItem.data.startTime,
          firstItem.data.endTime,
        );
        conclusion = `首站 ${timeRange} ${firstItem.data.title}`;
        statText = `${block.items.length} 节点`;
      }

      const previewNodes = flattened.slice(0, 2).map((item) => ({
        id: item.id,
        time: item.data.startTime,
        title: item.data.title,
        location: item.data.locationName?.trim() || undefined,
      }));

      return {
        blockId: block.id,
        pillText:
          block.items.length > 0
            ? `${shortTitle} ${block.items.length}`
            : shortTitle,
        statText,
        conclusion,
        preview:
          previewNodes.length > 0
            ? {
                kind: 'schedule',
                nodes: previewNodes,
                remainingCount: Math.max(
                  0,
                  flattened.length - previewNodes.length,
                ),
              }
            : undefined,
      };
    }

    case 'expense': {
      const currency = block.config.currency || 'CNY';
      const totalCents = block.items.reduce(
        (sum, entry) => sum + Math.round(entry.data.amount * 100),
        0,
      );
      const spentShort =
        totalCents > 0
          ? `¥${Math.round(totalCents / 100)}`
          : '暂无账目';
      const spentFull = formatCents(totalCents, currency);

      if (block.config.mode === 'budget') {
        const budgetCents =
          block.config.totalBudget !== null
            ? Math.round(block.config.totalBudget * 100)
            : null;
        const isOverspent =
          budgetCents !== null && totalCents > budgetCents;
        const progressPercent =
          budgetCents !== null && budgetCents > 0
            ? Math.min(100, Math.round((totalCents / budgetCents) * 100))
            : undefined;

        let conclusion =
          block.items.length === 0
            ? '暂无支出记录，点击记入第一笔'
            : `${block.items.length} 笔支出 · 累计 ${spentFull}`;
        if (budgetCents !== null) {
          const diff = budgetCents - totalCents;
          conclusion = isOverspent
            ? `已超支 ${formatCents(Math.abs(diff), currency)}（预算 ${formatCents(budgetCents, currency)}）`
            : `剩余预算 ${formatCents(diff, currency)} · 共 ${block.items.length} 笔`;
        }

        return {
          blockId: block.id,
          pillText:
            totalCents > 0 ? `${shortTitle} ${spentShort}` : shortTitle,
          statText: spentFull,
          conclusion,
          progressPercent,
          isAlert: isOverspent,
        };
      }

      const splitSummary = computeMinimalTransfers(
        block.items.map((entry) => entry.data),
      );
      const conclusion =
        block.items.length === 0
          ? '暂无消费记录，记账后自动算 AA 转账'
          : splitSummary.transfers.length === 0
            ? `${block.items.length} 笔账目 · 当前全员已平账`
            : `${block.items.length} 笔账目 · 最少转账 ${splitSummary.transfers.length} 笔`;

      const previewTransfers = splitSummary.transfers.slice(0, 2).map((tx) => ({
        fromUserId: tx.fromUserId,
        toUserId: tx.toUserId,
        amountText: formatCents(tx.amountCents, currency),
      }));

      return {
        blockId: block.id,
        pillText: totalCents > 0 ? `${shortTitle} ${spentShort}` : shortTitle,
        statText: spentFull,
        conclusion,
        preview:
          previewTransfers.length > 0
            ? {
                kind: 'expense_transfers',
                transfers: previewTransfers,
                remainingCount: Math.max(
                  0,
                  splitSummary.transfers.length - previewTransfers.length,
                ),
              }
            : undefined,
      };
    }
  }
}

/**
 * Selects up to `limit` latest visible chat messages for the Overview chat preview strip.
 */
export function selectRecentChatPreviewMessages(
  messages: readonly ParsedRoomMessage[],
  blockedUserIds: ReadonlySet<string>,
  limit = 2,
): ParsedRoomMessage[] {
  const visible = messages.filter(
    (msg) =>
      !msg.is_deleted &&
      (!msg.sender_id || !blockedUserIds.has(msg.sender_id)) &&
      msg.content.trim().length > 0,
  );
  if (visible.length <= limit) {
    return visible;
  }
  return visible.slice(visible.length - limit);
}

/** Formats a short `HH:mm` or `M/D HH:mm` stamp for compact Overview chat previews. */
export function formatCompactChatTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return '';
  }
  const d = new Date(ms);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const isSameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isSameDay) {
    return `${hh}:${mm}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/**
 * Collects compact actionable nudges for the Overview "needs your attention" strip.
 */
export function collectBoardPendingActions(params: {
  blocks: ParsedBlock[];
  talliesByBlockId: Map<string, PollTally[]>;
  currentUserId: string | null;
  isReadOnly: boolean;
}): BoardPendingAction[] {
  const { blocks, talliesByBlockId, currentUserId, isReadOnly } = params;
  if (isReadOnly) {
    return [];
  }

  const actions: BoardPendingAction[] = [];

  for (const block of blocks) {
    if (block.type === 'poll') {
      if (block.config.isLocked || block.items.length === 0) {
        continue;
      }
      const tallies = talliesByBlockId.get(block.id) ?? [];
      const userHasVoted =
        Boolean(currentUserId) &&
        tallies.some((t) => t.my_voted);
      if (!userHasVoted) {
        actions.push({
          id: `pending-poll-${block.id}`,
          kind: 'poll',
          blockId: block.id,
          text: `「${block.title}」等你投票`,
          ctaLabel: '去投票',
        });
      }
    } else if (block.type === 'task') {
      const unclaimed = block.items.filter(
        (item) => item.data.status === 'unclaimed',
      );
      if (unclaimed.length > 0) {
        const firstUnclaimed = unclaimed[0];
        const firstTitle = firstUnclaimed
          ? truncateText(firstUnclaimed.data.title, 10)
          : '';
        actions.push({
          id: `pending-task-${block.id}`,
          kind: 'task',
          blockId: block.id,
          text:
            unclaimed.length === 1
              ? `1 项分工待认领：${firstTitle}`
              : `${unclaimed.length} 项分工待认领（${firstTitle}等）`,
          ctaLabel: '去认领',
        });
      }
    }
  }

  return actions.slice(0, 3);
}
