import type { ParsedBlock } from '../api/blockHelpers';
import { formatRoomEventWindow } from '../api/roomHelpers';
import type { PollTally, TaskStatus } from '../schemas/blocks';
import type {
  RoomMemberWithProfile,
  RoomRow,
  RoomStatus,
  TemplateType,
} from '../types/database';
import { sanitizePollTallyForDisplay } from './pollHelpers';
import {
  formatScheduleTimeRange,
  groupAndSortScheduleItems,
} from './scheduleHelpers';
import {
  type ExpenseInput,
  computeMinimalTransfers,
  formatCents,
} from './splitAlgorithm';
import {
  TASK_STATUS_LABELS,
  computeTaskCompletionStats,
  formatTaskDueAtLabel,
} from './taskHelpers';
import { ROOM_TEMPLATES } from './templates';

/** Input payload required to aggregate a room's collaborative recap. */
export interface BuildRoomRecapInput {
  room: RoomRow;
  members: RoomMemberWithProfile[];
  blocks: ParsedBlock[];
  pollTallies: PollTally[];
  generatedAt?: string;
}

/** Room header metadata included in a recap summary. */
export interface RecapRoomMeta {
  id: string;
  title: string;
  announcement: string;
  status: RoomStatus;
  statusLabel: string;
  templateType: TemplateType;
  templateLabel: string;
  eventWindow: string | null;
  activeMemberCount: number;
  memberNames: string[];
}

/** Aggregated option entry inside a recap poll conclusion (never exposes voter IDs). */
export interface RecapPollOptionSummary {
  itemId: string;
  label: string;
  voteCount: number;
  percentage: number;
  isWinner: boolean;
}

/** Aggregated conclusion for a single poll block, supporting tied winners. */
export interface RecapPollSummary {
  blockId: string;
  title: string;
  mode: 'option' | 'availability';
  anonymous: boolean;
  isLocked: boolean;
  totalVotes: number;
  maxVotes: number;
  winners: RecapPollOptionSummary[];
  options: RecapPollOptionSummary[];
}

/** Individual task line item formatted for recap display. */
export interface RecapTaskItemSummary {
  itemId: string;
  title: string;
  description: string;
  status: TaskStatus;
  statusLabel: string;
  assigneeNames: string[];
  dueLabel: string | null;
}

/** Per-block task checklist summary. */
export interface RecapTaskSection {
  blockId: string;
  title: string;
  total: number;
  done: number;
  inProgress: number;
  unclaimed: number;
  completionRate: number;
  completionPercent: number;
  items: RecapTaskItemSummary[];
}

/** Room-wide task completion metrics and per-block checklists. */
export interface RecapTaskSummary {
  total: number;
  done: number;
  inProgress: number;
  unclaimed: number;
  completionRate: number;
  completionPercent: number;
  sections: RecapTaskSection[];
}

/** Individual schedule stop formatted for recap timeline rendering. */
export interface RecapScheduleItemSummary {
  itemId: string;
  title: string;
  timeDisplay: string;
  locationName: string | null;
  ownerName: string | null;
  notes: string;
}

/** Grouped schedule stops sharing a `groupLabel`. */
export interface RecapScheduleGroupSummary {
  groupLabel: string;
  items: RecapScheduleItemSummary[];
}

/** Per-block schedule timeline summary. */
export interface RecapScheduleSection {
  blockId: string;
  title: string;
  groupBy: 'day' | 'phase';
  groups: RecapScheduleGroupSummary[];
  totalItems: number;
}

/** Room-wide schedule summary across all schedule blocks. */
export interface RecapScheduleSummary {
  totalItems: number;
  sections: RecapScheduleSection[];
}

/** Individual expense item formatted for recap accounting tables. */
export interface RecapExpenseItemSummary {
  itemId: string;
  title: string;
  amountCents: number;
  formattedAmount: string;
  paidByUserId: string;
  paidByName: string;
  participantNames: string[];
  spentAtLabel: string;
}

/** Human-readable minimal AA settlement transfer instruction. */
export interface RecapTransferSummary {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amountCents: number;
  formattedAmount: string;
}

/** Per-block expense budget or AA split summary. */
export interface RecapExpenseSection {
  blockId: string;
  title: string;
  mode: 'budget' | 'split';
  currency: string;
  totalBudgetCents: number | null;
  formattedTotalBudget: string | null;
  totalSpentCents: number;
  formattedTotalSpent: string;
  remainingBudgetCents: number | null;
  formattedRemainingBudget: string | null;
  isOverBudget: boolean;
  items: RecapExpenseItemSummary[];
  transfers: RecapTransferSummary[];
}

/** Room-wide expense totals, per-block breakdown, and minimal AA transfers. */
export interface RecapExpenseSummary {
  currency: string;
  totalSpentCents: number;
  formattedTotalSpent: string;
  totalBudgetCents: number | null;
  formattedTotalBudget: string | null;
  sections: RecapExpenseSection[];
  transfers: RecapTransferSummary[];
}

/** Complete structured recap snapshot consumed by `export.tsx` and `renderRecapHtml`. */
export interface RoomRecapData {
  room: RecapRoomMeta;
  generatedAt: string;
  generatedAtLabel: string;
  polls: RecapPollSummary[];
  tasks: RecapTaskSummary;
  schedule: RecapScheduleSummary;
  expenses: RecapExpenseSummary;
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

function formatGeneratedAtLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return iso;
  }
  const d = new Date(ms);
  return `${d.getFullYear()}-${padTwo(d.getMonth() + 1)}-${padTwo(d.getDate())} ${padTwo(d.getHours())}:${padTwo(d.getMinutes())}`;
}

function formatExpenseDateLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return iso;
  }
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function computeCompletionRate(done: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return done / total;
}

function computeCompletionPercent(done: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((done / total) * 100);
}

function buildMemberLookup(
  members: readonly RoomMemberWithProfile[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const member of members) {
    const nickname = member.profiles?.nickname?.trim() || '协作伙伴';
    map.set(member.user_id, nickname);
  }
  return map;
}

function buildPollSummary(
  block: ParsedBlock<'poll'>,
  tallyByItemId: ReadonlyMap<string, PollTally>,
): RecapPollSummary {
  const rawOptions = block.items.map((item) => {
    const rawTally = tallyByItemId.get(item.id);
    const sanitized = rawTally
      ? sanitizePollTallyForDisplay(rawTally, block.config.anonymous)
      : null;
    const voteCount = sanitized?.vote_count ?? 0;
    return {
      itemId: item.id,
      label: item.data.label,
      voteCount,
    };
  });

  const maxVotes = rawOptions.reduce(
    (max, opt) => Math.max(max, opt.voteCount),
    0,
  );
  const totalVotes = rawOptions.reduce((sum, opt) => sum + opt.voteCount, 0);

  const options: RecapPollOptionSummary[] = rawOptions
    .map((opt) => ({
      itemId: opt.itemId,
      label: opt.label,
      voteCount: opt.voteCount,
      percentage:
        totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0,
      isWinner: maxVotes > 0 && opt.voteCount === maxVotes,
    }))
    .sort((a, b) => b.voteCount - a.voteCount);

  return {
    blockId: block.id,
    title: block.title,
    mode: block.config.mode,
    anonymous: block.config.anonymous,
    isLocked: block.config.isLocked,
    totalVotes,
    maxVotes,
    winners: options.filter((opt) => opt.isWinner),
    options,
  };
}

function buildTasksSummary(
  taskBlocks: readonly ParsedBlock<'task'>[],
  resolveName: (userId: string) => string,
): RecapTaskSummary {
  let total = 0;
  let done = 0;
  let inProgress = 0;
  let unclaimed = 0;

  const sections: RecapTaskSection[] = taskBlocks.map((block) => {
    const stats = computeTaskCompletionStats(block.items);
    total += stats.total;
    done += stats.done;
    inProgress += stats.inProgress;
    unclaimed += stats.unclaimed;

    const items: RecapTaskItemSummary[] = block.items.map((item) => ({
      itemId: item.id,
      title: item.data.title,
      description: item.data.description,
      status: item.data.status,
      statusLabel: TASK_STATUS_LABELS[item.data.status],
      assigneeNames: item.data.assigneeIds.map(resolveName),
      dueLabel: formatTaskDueAtLabel(item.data.dueAt),
    }));

    return {
      blockId: block.id,
      title: block.title,
      total: stats.total,
      done: stats.done,
      inProgress: stats.inProgress,
      unclaimed: stats.unclaimed,
      completionRate: computeCompletionRate(stats.done, stats.total),
      completionPercent: computeCompletionPercent(stats.done, stats.total),
      items,
    };
  });

  return {
    total,
    done,
    inProgress,
    unclaimed,
    completionRate: computeCompletionRate(done, total),
    completionPercent: computeCompletionPercent(done, total),
    sections,
  };
}

function buildScheduleSummary(
  scheduleBlocks: readonly ParsedBlock<'schedule'>[],
  resolveName: (userId: string) => string,
): RecapScheduleSummary {
  let totalItems = 0;
  const sections: RecapScheduleSection[] = scheduleBlocks.map((block) => {
    const sortedGroups = groupAndSortScheduleItems(block.items);
    const groups: RecapScheduleGroupSummary[] = sortedGroups.map((group) => ({
      groupLabel: group.groupLabel,
      items: group.items.map((item) => {
        totalItems += 1;
        return {
          itemId: item.id,
          title: item.data.title,
          timeDisplay: formatScheduleTimeRange(
            item.data.startTime,
            item.data.endTime,
          ),
          locationName: item.data.locationName ?? null,
          ownerName: item.data.ownerId ? resolveName(item.data.ownerId) : null,
          notes: item.data.notes,
        };
      }),
    }));

    return {
      blockId: block.id,
      title: block.title,
      groupBy: block.config.groupBy,
      groups,
      totalItems: block.items.length,
    };
  });

  return {
    totalItems,
    sections,
  };
}

function toTransferSummaries(
  transfers: ReadonlyArray<{
    fromUserId: string;
    toUserId: string;
    amountCents: number;
  }>,
  currency: string,
  resolveName: (userId: string) => string,
): RecapTransferSummary[] {
  return transfers.map((transfer) => ({
    fromUserId: transfer.fromUserId,
    fromName: resolveName(transfer.fromUserId),
    toUserId: transfer.toUserId,
    toName: resolveName(transfer.toUserId),
    amountCents: transfer.amountCents,
    formattedAmount: formatCents(transfer.amountCents, currency),
  }));
}

function buildExpensesSummary(
  expenseBlocks: readonly ParsedBlock<'expense'>[],
  resolveName: (userId: string) => string,
): RecapExpenseSummary {
  const defaultCurrency = expenseBlocks[0]?.config.currency ?? 'CNY';
  let totalSpentCents = 0;
  let totalBudgetCents: number | null = null;
  const splitExpenseInputs: ExpenseInput[] = [];

  const sections: RecapExpenseSection[] = expenseBlocks.map((block) => {
    const currency = block.config.currency;
    const inputs: ExpenseInput[] = block.items.map((item) => ({
      amount: item.data.amount,
      paidByUserId: item.data.paidByUserId,
      participantIds: item.data.participantIds,
    }));

    if (block.config.mode === 'split') {
      splitExpenseInputs.push(...inputs);
    }

    const settlement = computeMinimalTransfers(inputs);
    totalSpentCents += settlement.totalSpentCents;

    const sectionBudgetCents =
      block.config.totalBudget !== null
        ? Math.round(block.config.totalBudget * 100)
        : null;

    if (sectionBudgetCents !== null) {
      totalBudgetCents = (totalBudgetCents ?? 0) + sectionBudgetCents;
    }

    const remainingBudgetCents =
      sectionBudgetCents !== null
        ? sectionBudgetCents - settlement.totalSpentCents
        : null;

    const items: RecapExpenseItemSummary[] = block.items.map((item) => {
      const amountCents = Math.round(item.data.amount * 100);
      return {
        itemId: item.id,
        title: item.data.title,
        amountCents,
        formattedAmount: formatCents(amountCents, currency),
        paidByUserId: item.data.paidByUserId,
        paidByName: resolveName(item.data.paidByUserId),
        participantNames: item.data.participantIds.map(resolveName),
        spentAtLabel: formatExpenseDateLabel(item.data.spentAt),
      };
    });

    return {
      blockId: block.id,
      title: block.title,
      mode: block.config.mode,
      currency,
      totalBudgetCents: sectionBudgetCents,
      formattedTotalBudget:
        sectionBudgetCents !== null
          ? formatCents(sectionBudgetCents, currency)
          : null,
      totalSpentCents: settlement.totalSpentCents,
      formattedTotalSpent: formatCents(settlement.totalSpentCents, currency),
      remainingBudgetCents,
      formattedRemainingBudget:
        remainingBudgetCents !== null
          ? formatCents(remainingBudgetCents, currency)
          : null,
      isOverBudget: remainingBudgetCents !== null && remainingBudgetCents < 0,
      items,
      transfers:
        block.config.mode === 'split'
          ? toTransferSummaries(settlement.transfers, currency, resolveName)
          : [],
    };
  });

  const combinedSplit = computeMinimalTransfers(splitExpenseInputs);

  return {
    currency: defaultCurrency,
    totalSpentCents,
    formattedTotalSpent: formatCents(totalSpentCents, defaultCurrency),
    totalBudgetCents,
    formattedTotalBudget:
      totalBudgetCents !== null
        ? formatCents(totalBudgetCents, defaultCurrency)
        : null,
    sections,
    transfers: toTransferSummaries(
      combinedSplit.transfers,
      defaultCurrency,
      resolveName,
    ),
  };
}

/**
 * Aggregates room metadata, poll conclusions (preserving anonymity and ties),
 * task completion rates, grouped schedule timelines, and budget/AA settlement plans.
 */
export function buildRoomRecapData(input: BuildRoomRecapInput): RoomRecapData {
  const { room, members, blocks, pollTallies } = input;
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  const memberNameById = buildMemberLookup(members);
  const resolveName = (userId: string): string =>
    memberNameById.get(userId) ?? '未知成员';

  const activeMembers = members.filter((m) => m.status === 'active');
  const tallyByItemId = new Map<string, PollTally>();
  for (const tally of pollTallies) {
    tallyByItemId.set(tally.item_id, tally);
  }

  const pollBlocks: ParsedBlock<'poll'>[] = [];
  const taskBlocks: ParsedBlock<'task'>[] = [];
  const scheduleBlocks: ParsedBlock<'schedule'>[] = [];
  const expenseBlocks: ParsedBlock<'expense'>[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'poll':
        pollBlocks.push(block);
        break;
      case 'task':
        taskBlocks.push(block);
        break;
      case 'schedule':
        scheduleBlocks.push(block);
        break;
      case 'expense':
        expenseBlocks.push(block);
        break;
    }
  }

  return {
    room: {
      id: room.id,
      title: room.title,
      announcement: room.announcement,
      status: room.status,
      statusLabel: room.status === 'archived' ? '已归档' : '进行中',
      templateType: room.template_type,
      templateLabel: ROOM_TEMPLATES[room.template_type]?.name ?? '自定义活动',
      eventWindow: formatRoomEventWindow(room.event_start_at, room.event_end_at),
      activeMemberCount: activeMembers.length,
      memberNames: activeMembers.map(
        (m) => m.profiles?.nickname?.trim() || '协作伙伴',
      ),
    },
    generatedAt,
    generatedAtLabel: formatGeneratedAtLabel(generatedAt),
    polls: pollBlocks.map((block) => buildPollSummary(block, tallyByItemId)),
    tasks: buildTasksSummary(taskBlocks, resolveName),
    schedule: buildScheduleSummary(scheduleBlocks, resolveName),
    expenses: buildExpensesSummary(expenseBlocks, resolveName),
  };
}

/** Strictly escapes HTML special characters (`&`, `<`, `>`, `"`, `'`) for safe PDF rendering. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPollSectionHtml(polls: readonly RecapPollSummary[]): string {
  if (polls.length === 0) {
    return '<p class="empty">暂无投票积木记录</p>';
  }

  return polls
    .map((poll) => {
      const winnerBanner =
        poll.winners.length > 0
          ? `<div class="winner-box">
               <span class="winner-tag">${poll.winners.length > 1 ? '并列最高票' : '最终胜出'}</span>
               <strong>${poll.winners.map((w) => escapeHtml(w.label)).join(' / ')}</strong>
               <span class="muted">(${poll.maxVotes} 票)</span>
             </div>`
          : '<p class="muted small">暂无人投票</p>';

      const optionsHtml =
        poll.options.length > 0
          ? poll.options
              .map(
                (opt) => `
              <div class="option-row ${opt.isWinner ? 'option-winner' : ''}">
                <div class="option-header">
                  <span>${escapeHtml(opt.label)}${opt.isWinner ? ' · 胜出' : ''}</span>
                  <span class="mono">${opt.voteCount} 票 (${opt.percentage}%)</span>
                </div>
                <div class="bar-track">
                  <div class="bar-fill ${opt.isWinner ? 'bar-primary' : 'bar-muted'}" style="width: ${opt.percentage}%"></div>
                </div>
              </div>`,
              )
              .join('')
          : '<p class="muted small">暂无候选项</p>';

      return `
        <div class="subcard">
          <div class="subcard-head">
            <h3>${escapeHtml(poll.title)}</h3>
            <span class="pill">${poll.anonymous ? '匿名投票' : '公开投票'} · 共 ${poll.totalVotes} 票</span>
          </div>
          ${winnerBanner}
          <div class="option-list">${optionsHtml}</div>
        </div>`;
    })
    .join('');
}

function renderTasksSectionHtml(tasks: RecapTaskSummary): string {
  if (tasks.sections.length === 0) {
    return '<p class="empty">暂无分工清单记录</p>';
  }

  const overviewHtml = `
    <div class="stat-box">
      <div class="stat-row">
        <span>总体完成度：<strong>${tasks.done} / ${tasks.total}</strong> (${tasks.completionPercent}%)</span>
        <span class="muted small">进行中 ${tasks.inProgress} · 待认领 ${tasks.unclaimed}</span>
      </div>
      <div class="bar-track bar-lg">
        <div class="bar-fill bar-primary" style="width: ${tasks.completionPercent}%"></div>
      </div>
    </div>`;

  const blocksHtml = tasks.sections
    .map((section) => {
      const itemsHtml =
        section.items.length > 0
          ? section.items
              .map((item) => {
                const statusClass =
                  item.status === 'done'
                    ? 'status-done'
                    : item.status === 'in_progress'
                      ? 'status-progress'
                      : 'status-pending';
                const assignees =
                  item.assigneeNames.length > 0
                    ? item.assigneeNames.map(escapeHtml).join('、')
                    : '未认领';
                const due = item.dueLabel
                  ? ` · 截止 ${escapeHtml(item.dueLabel)}`
                  : '';
                const desc = item.description
                  ? `<div class="muted small">${escapeHtml(item.description)}</div>`
                  : '';
                return `
                  <li class="task-item">
                    <span class="status-pill ${statusClass}">${escapeHtml(item.statusLabel)}</span>
                    <div class="task-body">
                      <div class="task-title">${escapeHtml(item.title)}</div>
                      ${desc}
                      <div class="muted small">负责人：${assignees}${due}</div>
                    </div>
                  </li>`;
              })
              .join('')
          : '<li class="muted small">暂无任务条目</li>';

      return `
        <div class="subcard">
          <div class="subcard-head">
            <h3>${escapeHtml(section.title)}</h3>
            <span class="pill">${section.done}/${section.total} 已完成</span>
          </div>
          <ul class="task-list">${itemsHtml}</ul>
        </div>`;
    })
    .join('');

  return `${overviewHtml}${blocksHtml}`;
}

function renderScheduleSectionHtml(schedule: RecapScheduleSummary): string {
  if (schedule.sections.length === 0 || schedule.totalItems === 0) {
    return '<p class="empty">暂无日程轴安排</p>';
  }

  return schedule.sections
    .map((section) => {
      const groupsHtml =
        section.groups.length > 0
          ? section.groups
              .map((group) => {
                const rowsHtml = group.items
                  .map((item) => {
                    const metaParts: string[] = [];
                    if (item.locationName) {
                      metaParts.push(`地点：${escapeHtml(item.locationName)}`);
                    }
                    if (item.ownerName) {
                      metaParts.push(`负责人：${escapeHtml(item.ownerName)}`);
                    }
                    if (item.notes) {
                      metaParts.push(`备注：${escapeHtml(item.notes)}`);
                    }
                    const metaLine =
                      metaParts.length > 0
                        ? `<div class="muted small">${metaParts.join(' · ')}</div>`
                        : '';
                    return `
                      <div class="timeline-row">
                        <span class="time-badge">${escapeHtml(item.timeDisplay)}</span>
                        <div class="timeline-content">
                          <div class="task-title">${escapeHtml(item.title)}</div>
                          ${metaLine}
                        </div>
                      </div>`;
                  })
                  .join('');

                return `
                  <div class="schedule-group">
                    <div class="group-label">${escapeHtml(group.groupLabel)}</div>
                    ${rowsHtml}
                  </div>`;
              })
              .join('')
          : '<p class="muted small">暂无日程节点</p>';

      return `
        <div class="subcard">
          <div class="subcard-head">
            <h3>${escapeHtml(section.title)}</h3>
            <span class="pill">共 ${section.totalItems} 项日程</span>
          </div>
          ${groupsHtml}
        </div>`;
    })
    .join('');
}

function renderExpensesSectionHtml(expenses: RecapExpenseSummary): string {
  if (expenses.sections.length === 0) {
    return '<p class="empty">暂无费用与 AA 分账记录</p>';
  }

  const budgetBit = expenses.formattedTotalBudget
    ? `<div class="kpi-item"><div class="kpi-label">总预算</div><div class="kpi-val">${escapeHtml(expenses.formattedTotalBudget)}</div></div>`
    : '';

  const kpiHtml = `
    <div class="kpi-grid">
      <div class="kpi-item">
        <div class="kpi-label">累计支出</div>
        <div class="kpi-val primary">${escapeHtml(expenses.formattedTotalSpent)}</div>
      </div>
      ${budgetBit}
    </div>`;

  const transfersHtml =
    expenses.transfers.length > 0
      ? `<div class="transfer-box">
           <div class="transfer-title">AA 最小化结算建议</div>
           ${expenses.transfers
             .map(
               (t) => `
             <div class="transfer-row">
               <span><strong>${escapeHtml(t.fromName)}</strong> → <strong>${escapeHtml(t.toName)}</strong></span>
               <span class="transfer-amount">${escapeHtml(t.formattedAmount)}</span>
             </div>`,
             )
             .join('')}
         </div>`
      : '';

  const sectionsHtml = expenses.sections
    .map((section) => {
      const itemsHtml =
        section.items.length > 0
          ? `<table class="exp-table">
               <thead>
                 <tr>
                   <th>项目</th>
                   <th>付款人</th>
                   <th>分摊成员</th>
                   <th class="right">金额</th>
                 </tr>
               </thead>
               <tbody>
                 ${section.items
                   .map(
                     (item) => `
                   <tr>
                     <td>${escapeHtml(item.title)}</td>
                     <td>${escapeHtml(item.paidByName)}</td>
                     <td>${item.participantNames.map(escapeHtml).join('、')}</td>
                     <td class="right mono">${escapeHtml(item.formattedAmount)}</td>
                   </tr>`,
                   )
                   .join('')}
               </tbody>
             </table>`
          : '<p class="muted small">暂无账单记录</p>';

      const modeLabel =
        section.mode === 'budget'
          ? section.formattedTotalBudget
            ? `预算 ${escapeHtml(section.formattedTotalBudget)}`
            : '预算追踪'
          : 'AA 分账';

      return `
        <div class="subcard">
          <div class="subcard-head">
            <h3>${escapeHtml(section.title)}</h3>
            <span class="pill">${modeLabel} · 已支 ${escapeHtml(section.formattedTotalSpent)}</span>
          </div>
          ${itemsHtml}
        </div>`;
    })
    .join('');

  return `${kpiHtml}${transfersHtml}${sectionsHtml}`;
}

/**
 * Renders a standalone warm-tangerine A4 print-ready HTML document for `expo-print`,
 * strictly escaping all user-supplied text.
 */
export function renderRecapHtml(recap: RoomRecapData): string {
  const eventWindowHtml = recap.room.eventWindow
    ? `<span class="meta-chip">活动时间：${escapeHtml(recap.room.eventWindow)}</span>`
    : '';
  const announcementHtml = recap.room.announcement
    ? `<div class="announcement">${escapeHtml(recap.room.announcement)}</div>`
    : '';
  const memberChipsHtml = recap.room.memberNames
    .map((name) => `<span class="member-chip">${escapeHtml(name)}</span>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(recap.room.title)} - 轻橘 PopRoom 活动复盘</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      background-color: #F8FAFC;
      color: #18181B;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      max-width: 760px;
      margin: 0 auto;
      background: #FFFFFF;
      border-radius: 18px;
      border: 1px solid #E4E4E7;
      overflow: hidden;
    }
    .hero {
      background: linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%);
      border-bottom: 1px solid #FED7AA;
      padding: 24px 24px 20px;
    }
    .brand-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .brand {
      display: inline-block;
      background: #F97316;
      color: #FFFFFF;
      font-size: 12px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 999px;
      letter-spacing: 0.5px;
    }
    .status-badge {
      font-size: 12px;
      font-weight: 600;
      color: #9A3412;
      background: #FFFFFF;
      border: 1px solid #FDBA74;
      padding: 3px 10px;
      border-radius: 999px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 24px;
      font-weight: 800;
      color: #18181B;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .meta-chip {
      font-size: 12px;
      color: #52525B;
      background: rgba(255, 255, 255, 0.85);
      padding: 3px 10px;
      border-radius: 999px;
    }
    .announcement {
      margin-top: 10px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.9);
      border-left: 3px solid #F97316;
      border-radius: 8px;
      font-size: 13px;
      color: #3F3F46;
      white-space: pre-wrap;
    }
    .members-row {
      margin-top: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .member-chip {
      font-size: 11px;
      color: #18181B;
      background: #FFFFFF;
      border: 1px solid #FDBA74;
      padding: 2px 8px;
      border-radius: 999px;
    }
    .content { padding: 20px 24px 24px; }
    .section { margin-bottom: 22px; page-break-inside: avoid; }
    .section-title {
      font-size: 16px;
      font-weight: 800;
      color: #18181B;
      margin: 0 0 12px;
      padding-left: 10px;
      border-left: 4px solid #F97316;
    }
    .subcard {
      background: #FFFFFF;
      border: 1px solid #E4E4E7;
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 10px;
    }
    .subcard-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .subcard-head h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: #18181B;
    }
    .pill {
      font-size: 11px;
      font-weight: 600;
      color: #52525B;
      background: #F4F4F5;
      padding: 2px 8px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .winner-box {
      background: #FFF7ED;
      border: 1px solid #FDBA74;
      border-radius: 10px;
      padding: 8px 12px;
      margin-bottom: 10px;
      font-size: 13px;
      color: #18181B;
    }
    .winner-tag {
      display: inline-block;
      background: #F97316;
      color: #FFFFFF;
      font-size: 11px;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 999px;
      margin-right: 6px;
    }
    .option-row { margin-bottom: 8px; }
    .option-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .bar-track {
      height: 7px;
      background: #F4F4F5;
      border-radius: 999px;
      overflow: hidden;
    }
    .bar-lg { height: 10px; margin-top: 6px; }
    .bar-fill { height: 100%; border-radius: 999px; }
    .bar-primary { background: #F97316; }
    .bar-muted { background: #D4D4D8; }
    .stat-box {
      background: #FFF7ED;
      border: 1px solid #FED7AA;
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 10px;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
    }
    .task-list { list-style: none; padding: 0; margin: 0; }
    .task-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 7px 0;
      border-bottom: 1px solid #F4F4F5;
    }
    .task-item:last-child { border-bottom: none; }
    .status-pill {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .status-done { background: #ECFDF5; color: #047857; }
    .status-progress { background: #FFF7ED; color: #C2410C; }
    .status-pending { background: #F4F4F5; color: #52525B; }
    .task-body { flex: 1; }
    .task-title { font-size: 13px; font-weight: 600; color: #18181B; }
    .schedule-group { margin-bottom: 10px; }
    .group-label {
      font-size: 12px;
      font-weight: 700;
      color: #F97316;
      margin-bottom: 6px;
    }
    .timeline-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 6px 0;
      border-left: 2px solid #FED7AA;
      padding-left: 10px;
      margin-left: 4px;
    }
    .time-badge {
      font-size: 12px;
      font-weight: 700;
      color: #9A3412;
      background: #FFF7ED;
      padding: 2px 8px;
      border-radius: 6px;
      white-space: nowrap;
    }
    .timeline-content { flex: 1; }
    .kpi-grid {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
    }
    .kpi-item {
      flex: 1;
      background: #F8FAFC;
      border: 1px solid #E4E4E7;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .kpi-label { font-size: 11px; color: #71717A; }
    .kpi-val { font-size: 18px; font-weight: 800; color: #18181B; margin-top: 2px; }
    .kpi-val.primary { color: #F97316; }
    .transfer-box {
      background: #FFF7ED;
      border: 1px solid #FDBA74;
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 10px;
    }
    .transfer-title {
      font-size: 13px;
      font-weight: 700;
      color: #9A3412;
      margin-bottom: 6px;
    }
    .transfer-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      padding: 4px 0;
    }
    .transfer-amount { font-weight: 700; color: #F97316; }
    .exp-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .exp-table th, .exp-table td {
      text-align: left;
      padding: 6px 4px;
      border-bottom: 1px solid #F4F4F5;
    }
    .exp-table th { color: #71717A; font-weight: 600; }
    .right { text-align: right !important; }
    .mono { font-variant-numeric: tabular-nums; }
    .muted { color: #71717A; }
    .small { font-size: 12px; }
    .empty { color: #A1A1AA; font-size: 13px; margin: 4px 0 0; }
    .footer {
      border-top: 1px solid #F4F4F5;
      padding: 12px 24px;
      background: #FAFAFA;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #A1A1AA;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="hero">
      <div class="brand-row">
        <span class="brand">轻橘 PopRoom · 活动复盘单</span>
        <span class="status-badge">${escapeHtml(recap.room.statusLabel)}</span>
      </div>
      <h1>${escapeHtml(recap.room.title)}</h1>
      <div class="meta-row">
        <span class="meta-chip">${escapeHtml(recap.room.templateLabel)}</span>
        <span class="meta-chip">参与成员：${recap.room.activeMemberCount} 人</span>
        ${eventWindowHtml}
      </div>
      ${announcementHtml}
      ${memberChipsHtml ? `<div class="members-row">${memberChipsHtml}</div>` : ''}
    </div>
    <div class="content">
      <div class="section">
        <h2 class="section-title">投票结论</h2>
        ${renderPollSectionHtml(recap.polls)}
      </div>
      <div class="section">
        <h2 class="section-title">分工完成度</h2>
        ${renderTasksSectionHtml(recap.tasks)}
      </div>
      <div class="section">
        <h2 class="section-title">最终日程轴</h2>
        ${renderScheduleSectionHtml(recap.schedule)}
      </div>
      <div class="section">
        <h2 class="section-title">费用与 AA 结算</h2>
        ${renderExpensesSectionHtml(recap.expenses)}
      </div>
    </div>
    <div class="footer">
      <span>由 轻橘 PopRoom 自动生成</span>
      <span>生成时间：${escapeHtml(recap.generatedAtLabel)}</span>
    </div>
  </div>
</body>
</html>`;
}
