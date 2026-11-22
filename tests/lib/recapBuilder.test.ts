import { describe, expect, it } from 'vitest';
import type { ParsedBlock } from '@/src/api/blockHelpers';
import { computeRoomPermissions } from '@/src/hooks/useRoomPermissions';
import {
  buildRoomRecapData,
  escapeHtml,
  renderRecapHtml,
} from '@/src/lib/recapBuilder';
import type { PollTally } from '@/src/schemas/blocks';
import type {
  MemberRole,
  RoomMemberWithProfile,
  RoomRow,
} from '@/src/types/database';

function makeRoom(overrides: Partial<RoomRow> = {}): RoomRow {
  return {
    id: 'room-1',
    title: '周末梧桐山徒步',
    announcement: '周六早 8:30 南门集合，请带足饮用水',
    template_type: 'travel',
    event_start_at: '2026-11-28T00:30:00.000Z',
    event_end_at: '2026-11-28T10:00:00.000Z',
    join_mode: 'passcode',
    room_code: 'POP888',
    chat_enabled: false,
    allow_member_create_poll: true,
    status: 'active',
    archived_at: null,
    created_by: 'u-host',
    created_at: '2026-11-20T10:00:00.000Z',
    updated_at: '2026-11-22T10:00:00.000Z',
    ...overrides,
  };
}

function makeMember(
  userId: string,
  nickname: string,
  role: MemberRole = 'member',
  status: RoomMemberWithProfile['status'] = 'active',
): RoomMemberWithProfile {
  return {
    id: `rm-${userId}`,
    room_id: 'room-1',
    user_id: userId,
    role,
    status,
    apply_note: null,
    joined_at: '2026-11-20T10:05:00.000Z',
    profiles: {
      id: userId,
      nickname,
      avatar_color: '#F97316',
      avatar_url: null,
    },
  };
}

describe('recapBuilder', () => {
  it('aggregates polls (including ties & anonymity), tasks, sorted schedule, and AA transfers across mixed empty/populated blocks', () => {
    const room = makeRoom({ status: 'archived', archived_at: '2026-11-29T12:00:00.000Z' });
    const members: RoomMemberWithProfile[] = [
      makeMember('u-host', '阿橘', 'host', 'active'),
      makeMember('u-b', '小满', 'member', 'active'),
      makeMember('u-c', '林风', 'member', 'active'),
      makeMember('u-pending', '待审新友', 'member', 'pending'),
      makeMember('u-kicked', '已移出', 'member', 'kicked'),
    ];

    const blocks: ParsedBlock[] = [
      {
        id: 'blk-poll-tie',
        room_id: 'room-1',
        type: 'poll',
        title: '午餐餐厅投票',
        sort_order: 0,
        config: {
          mode: 'option',
          multiple: false,
          anonymous: true,
          allowAddOption: true,
          deadline: null,
          isLocked: true,
        },
        created_by: 'u-host',
        created_at: '2026-11-20T10:10:00.000Z',
        updated_at: '2026-11-20T10:10:00.000Z',
        items: [
          {
            id: 'opt-1',
            block_id: 'blk-poll-tie',
            room_id: 'room-1',
            type: 'poll',
            data: { label: '山脚窑鸡' },
            sort_order: 0,
            is_deleted: false,
            created_by: 'u-host',
            created_at: '2026-11-20T10:11:00.000Z',
            updated_at: '2026-11-20T10:11:00.000Z',
          },
          {
            id: 'opt-2',
            block_id: 'blk-poll-tie',
            room_id: 'room-1',
            type: 'poll',
            data: { label: '客家农家菜' },
            sort_order: 1,
            is_deleted: false,
            created_by: 'u-b',
            created_at: '2026-11-20T10:12:00.000Z',
            updated_at: '2026-11-20T10:12:00.000Z',
          },
          {
            id: 'opt-3',
            block_id: 'blk-poll-tie',
            room_id: 'room-1',
            type: 'poll',
            data: { label: '自备路餐' },
            sort_order: 2,
            is_deleted: false,
            created_by: 'u-c',
            created_at: '2026-11-20T10:13:00.000Z',
            updated_at: '2026-11-20T10:13:00.000Z',
          },
        ],
      },
      {
        id: 'blk-poll-empty',
        room_id: 'room-1',
        type: 'poll',
        title: '空投票积木',
        sort_order: 1,
        config: {
          mode: 'option',
          multiple: false,
          anonymous: false,
          allowAddOption: true,
          deadline: null,
          isLocked: false,
        },
        created_by: 'u-host',
        created_at: '2026-11-20T10:14:00.000Z',
        updated_at: '2026-11-20T10:14:00.000Z',
        items: [],
      },
      {
        id: 'blk-task',
        room_id: 'room-1',
        type: 'task',
        title: '分工与物资',
        sort_order: 2,
        config: { allowMemberCreate: true },
        created_by: 'u-host',
        created_at: '2026-11-20T10:15:00.000Z',
        updated_at: '2026-11-20T10:15:00.000Z',
        items: [
          {
            id: 'task-1',
            block_id: 'blk-task',
            room_id: 'room-1',
            type: 'task',
            data: {
              title: '购买急救包',
              description: '含创可贴和碘伏',
              status: 'done',
              assigneeIds: ['u-host'],
              dueAt: '2026-11-27T15:59:00.000Z',
              imageUrls: [],
            },
            sort_order: 0,
            is_deleted: false,
            created_by: 'u-host',
            created_at: '2026-11-20T10:16:00.000Z',
            updated_at: '2026-11-20T10:16:00.000Z',
          },
          {
            id: 'task-2',
            block_id: 'blk-task',
            room_id: 'room-1',
            type: 'task',
            data: {
              title: '带露营垫',
              description: '',
              status: 'in_progress',
              assigneeIds: ['u-b'],
              dueAt: null,
              imageUrls: [],
            },
            sort_order: 1,
            is_deleted: false,
            created_by: 'u-b',
            created_at: '2026-11-20T10:17:00.000Z',
            updated_at: '2026-11-20T10:17:00.000Z',
          },
          {
            id: 'task-3',
            block_id: 'blk-task',
            room_id: 'room-1',
            type: 'task',
            data: {
              title: '准备蓝牙音箱',
              description: '',
              status: 'done',
              assigneeIds: ['u-c'],
              dueAt: null,
              imageUrls: [],
            },
            sort_order: 2,
            is_deleted: false,
            created_by: 'u-c',
            created_at: '2026-11-20T10:18:00.000Z',
            updated_at: '2026-11-20T10:18:00.000Z',
          },
          {
            id: 'task-4',
            block_id: 'blk-task',
            room_id: 'room-1',
            type: 'task',
            data: {
              title: '带垃圾袋',
              description: '',
              status: 'unclaimed',
              assigneeIds: [],
              dueAt: null,
              imageUrls: [],
            },
            sort_order: 3,
            is_deleted: false,
            created_by: 'u-host',
            created_at: '2026-11-20T10:19:00.000Z',
            updated_at: '2026-11-20T10:19:00.000Z',
          },
        ],
      },
      {
        id: 'blk-schedule',
        room_id: 'room-1',
        type: 'schedule',
        title: '行程时间轴',
        sort_order: 3,
        config: { groupBy: 'day' },
        created_by: 'u-host',
        created_at: '2026-11-20T10:20:00.000Z',
        updated_at: '2026-11-20T10:20:00.000Z',
        items: [
          {
            id: 'sch-2',
            block_id: 'blk-schedule',
            room_id: 'room-1',
            type: 'schedule',
            data: {
              groupLabel: 'Day 1',
              startTime: '12:00',
              endTime: '13:30',
              title: '山顶午餐休整',
              locationName: '好汉坡平台',
              ownerId: 'u-b',
              notes: '',
            },
            sort_order: 0,
            is_deleted: false,
            created_by: 'u-host',
            created_at: '2026-11-20T10:21:00.000Z',
            updated_at: '2026-11-20T10:21:00.000Z',
          },
          {
            id: 'sch-1',
            block_id: 'blk-schedule',
            room_id: 'room-1',
            type: 'schedule',
            data: {
              groupLabel: 'Day 1',
              startTime: '08:30',
              title: '南门集合出发',
              locationName: '梧桐山南门',
              ownerId: 'u-host',
              notes: '准时点名',
            },
            sort_order: 1,
            is_deleted: false,
            created_by: 'u-host',
            created_at: '2026-11-20T10:22:00.000Z',
            updated_at: '2026-11-20T10:22:00.000Z',
          },
        ],
      },
      {
        id: 'blk-expense-split',
        room_id: 'room-1',
        type: 'expense',
        title: 'AA 分账',
        sort_order: 4,
        config: { mode: 'split', totalBudget: null, currency: 'CNY' },
        created_by: 'u-host',
        created_at: '2026-11-20T10:25:00.000Z',
        updated_at: '2026-11-20T10:25:00.000Z',
        items: [
          {
            id: 'exp-1',
            block_id: 'blk-expense-split',
            room_id: 'room-1',
            type: 'expense',
            data: {
              title: '午餐聚餐',
              amount: 150,
              paidByUserId: 'u-host',
              participantIds: ['u-host', 'u-b', 'u-c'],
              receiptUrl: null,
              spentAt: '2026-11-28T05:00:00.000Z',
            },
            sort_order: 0,
            is_deleted: false,
            created_by: 'u-host',
            created_at: '2026-11-28T05:05:00.000Z',
            updated_at: '2026-11-28T05:05:00.000Z',
          },
        ],
      },
      {
        id: 'blk-expense-budget',
        room_id: 'room-1',
        type: 'expense',
        title: '活动经费预算',
        sort_order: 5,
        config: { mode: 'budget', totalBudget: 200, currency: 'CNY' },
        created_by: 'u-host',
        created_at: '2026-11-20T10:26:00.000Z',
        updated_at: '2026-11-20T10:26:00.000Z',
        items: [
          {
            id: 'exp-2',
            block_id: 'blk-expense-budget',
            room_id: 'room-1',
            type: 'expense',
            data: {
              title: '矿泉水整箱',
              amount: 45,
              paidByUserId: 'u-b',
              participantIds: ['u-host', 'u-b', 'u-c'],
              receiptUrl: null,
              spentAt: '2026-11-28T01:00:00.000Z',
            },
            sort_order: 0,
            is_deleted: false,
            created_by: 'u-b',
            created_at: '2026-11-28T01:05:00.000Z',
            updated_at: '2026-11-28T01:05:00.000Z',
          },
        ],
      },
    ];

    // Even if stale voter_ids exist on an anonymous poll tally, recapBuilder must never expose them.
    const pollTallies: PollTally[] = [
      {
        item_id: 'opt-1',
        block_id: 'blk-poll-tie',
        vote_count: 2,
        my_voted: true,
        voter_ids: ['u-host', 'u-b'],
      },
      {
        item_id: 'opt-2',
        block_id: 'blk-poll-tie',
        vote_count: 2,
        my_voted: false,
        voter_ids: ['u-b', 'u-c'],
      },
      {
        item_id: 'opt-3',
        block_id: 'blk-poll-tie',
        vote_count: 1,
        my_voted: false,
        voter_ids: ['u-c'],
      },
    ];

    const recap = buildRoomRecapData({
      room,
      members,
      blocks,
      pollTallies,
      generatedAt: '2026-11-29T12:30:00.000Z',
    });

    // Room metadata & active member count (only active members)
    expect(recap.room.id).toBe('room-1');
    expect(recap.room.title).toBe('周末梧桐山徒步');
    expect(recap.room.status).toBe('archived');
    expect(recap.room.statusLabel).toBe('已归档');
    expect(recap.room.activeMemberCount).toBe(3);
    expect(recap.room.memberNames).toEqual(['阿橘', '小满', '林风']);

    // Poll conclusions with tie support and zero voter identity leakage
    expect(recap.polls).toHaveLength(2);
    const lunchPoll = recap.polls[0];
    expect(lunchPoll?.title).toBe('午餐餐厅投票');
    expect(lunchPoll?.anonymous).toBe(true);
    expect(lunchPoll?.maxVotes).toBe(2);
    expect(lunchPoll?.totalVotes).toBe(5);
    expect(lunchPoll?.winners.map((w) => w.label)).toEqual([
      '山脚窑鸡',
      '客家农家菜',
    ]);
    expect(JSON.stringify(lunchPoll)).not.toContain('u-host');
    expect(JSON.stringify(lunchPoll)).not.toContain('u-b');
    expect(JSON.stringify(lunchPoll)).not.toContain('voter_ids');

    const emptyPoll = recap.polls[1];
    expect(emptyPoll?.winners).toEqual([]);
    expect(emptyPoll?.totalVotes).toBe(0);

    // Task completion rate (2 / 4 = 0.5) & breakdown
    expect(recap.tasks.total).toBe(4);
    expect(recap.tasks.done).toBe(2);
    expect(recap.tasks.inProgress).toBe(1);
    expect(recap.tasks.unclaimed).toBe(1);
    expect(recap.tasks.completionRate).toBe(0.5);
    expect(recap.tasks.completionPercent).toBe(50);

    // Grouped schedule sorted ascending by startTime (08:30 before 12:00)
    expect(recap.schedule.totalItems).toBe(2);
    expect(recap.schedule.sections[0]?.groups[0]?.groupLabel).toBe('Day 1');
    expect(
      recap.schedule.sections[0]?.groups[0]?.items.map((i) => i.title),
    ).toEqual(['南门集合出发', '山顶午餐休整']);
    expect(recap.schedule.sections[0]?.groups[0]?.items[0]?.ownerName).toBe(
      '阿橘',
    );

    // Expense summary & minimal AA transfers
    expect(recap.expenses.totalSpentCents).toBe(19500);
    expect(recap.expenses.formattedTotalSpent).toBe('¥195.00');
    expect(recap.expenses.totalBudgetCents).toBe(20000);
    expect(recap.expenses.formattedTotalBudget).toBe('¥200.00');
    expect(recap.expenses.transfers).toEqual([
      {
        fromUserId: 'u-b',
        fromName: '小满',
        toUserId: 'u-host',
        toName: '阿橘',
        amountCents: 5000,
        formattedAmount: '¥50.00',
      },
      {
        fromUserId: 'u-c',
        fromName: '林风',
        toUserId: 'u-host',
        toName: '阿橘',
        amountCents: 5000,
        formattedAmount: '¥50.00',
      },
    ]);
  });

  it('safely returns 0 task completion rate when a room has zero tasks', () => {
    const recap = buildRoomRecapData({
      room: makeRoom({ status: 'active' }),
      members: [makeMember('u-host', '阿橘', 'host', 'active')],
      blocks: [
        {
          id: 'blk-task-empty',
          room_id: 'room-1',
          type: 'task',
          title: '待办清单',
          sort_order: 0,
          config: { allowMemberCreate: true },
          created_by: 'u-host',
          created_at: '2026-11-20T10:15:00.000Z',
          updated_at: '2026-11-20T10:15:00.000Z',
          items: [],
        },
      ],
      pollTallies: [],
    });

    expect(recap.tasks.total).toBe(0);
    expect(recap.tasks.done).toBe(0);
    expect(recap.tasks.completionRate).toBe(0);
    expect(Number.isNaN(recap.tasks.completionRate)).toBe(false);
    expect(recap.tasks.completionPercent).toBe(0);
    expect(recap.expenses.totalSpentCents).toBe(0);
    expect(recap.expenses.transfers).toEqual([]);
  });

  it('escapes <script>, &, ", and \' across all user-supplied fields in renderRecapHtml', () => {
    const payload = '<script>alert("xss")</script> & \'quote\'';
    const escaped = escapeHtml(payload);
    expect(escaped).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;quote&#39;',
    );

    const room = makeRoom({
      title: `活动 <script>alert("title")</script> & '1'`,
      announcement: `公告 <img src=x onerror="alert('a')"> & 'ok'`,
    });

    const members = [
      makeMember('u-host', `Host <script>&"'`, 'host', 'active'),
      makeMember('u-b', `Guest & "B"`, 'member', 'active'),
    ];

    const blocks: ParsedBlock[] = [
      {
        id: 'blk-p',
        room_id: 'room-1',
        type: 'poll',
        title: `投票 <script>&"'`,
        sort_order: 0,
        config: {
          mode: 'option',
          multiple: false,
          anonymous: false,
          allowAddOption: true,
          deadline: null,
          isLocked: false,
        },
        created_by: 'u-host',
        created_at: '2026-11-20T10:00:00.000Z',
        updated_at: '2026-11-20T10:00:00.000Z',
        items: [
          {
            id: 'opt-xss',
            block_id: 'blk-p',
            room_id: 'room-1',
            type: 'poll',
            data: { label: `选项 <script>evil()</script> & "'` },
            sort_order: 0,
            is_deleted: false,
            created_by: 'u-host',
            created_at: '2026-11-20T10:01:00.000Z',
            updated_at: '2026-11-20T10:01:00.000Z',
          },
        ],
      },
      {
        id: 'blk-t',
        room_id: 'room-1',
        type: 'task',
        title: `任务区 & <script>`,
        sort_order: 1,
        config: { allowMemberCreate: true },
        created_by: 'u-host',
        created_at: '2026-11-20T10:02:00.000Z',
        updated_at: '2026-11-20T10:02:00.000Z',
        items: [
          {
            id: 'task-xss',
            block_id: 'blk-t',
            room_id: 'room-1',
            type: 'task',
            data: {
              title: `任务 <script>t()</script> & "'`,
              description: `描述 <script>d()</script>`,
              status: 'done',
              assigneeIds: ['u-host'],
              dueAt: null,
              imageUrls: [],
            },
            sort_order: 0,
            is_deleted: false,
            created_by: 'u-host',
            created_at: '2026-11-20T10:03:00.000Z',
            updated_at: '2026-11-20T10:03:00.000Z',
          },
        ],
      },
      {
        id: 'blk-s',
        room_id: 'room-1',
        type: 'schedule',
        title: `日程 <script>`,
        sort_order: 2,
        config: { groupBy: 'day' },
        created_by: 'u-host',
        created_at: '2026-11-20T10:04:00.000Z',
        updated_at: '2026-11-20T10:04:00.000Z',
        items: [
          {
            id: 'sch-xss',
            block_id: 'blk-s',
            room_id: 'room-1',
            type: 'schedule',
            data: {
              groupLabel: `Day <script> & "'`,
              startTime: '09:00',
              title: `集合 <script>s()</script>`,
              locationName: `地点 <script>loc()</script> & "'`,
              ownerId: 'u-b',
              notes: `备注 <script>n()</script>`,
            },
            sort_order: 0,
            is_deleted: false,
            created_by: 'u-host',
            created_at: '2026-11-20T10:05:00.000Z',
            updated_at: '2026-11-20T10:05:00.000Z',
          },
        ],
      },
      {
        id: 'blk-e',
        room_id: 'room-1',
        type: 'expense',
        title: `费用 <script>`,
        sort_order: 3,
        config: { mode: 'split', totalBudget: null, currency: 'CNY' },
        created_by: 'u-host',
        created_at: '2026-11-20T10:06:00.000Z',
        updated_at: '2026-11-20T10:06:00.000Z',
        items: [
          {
            id: 'exp-xss',
            block_id: 'blk-e',
            room_id: 'room-1',
            type: 'expense',
            data: {
              title: `账单 <script>e()</script> & "'`,
              amount: 100,
              paidByUserId: 'u-host',
              participantIds: ['u-host', 'u-b'],
              receiptUrl: null,
              spentAt: '2026-11-28T05:00:00.000Z',
            },
            sort_order: 0,
            is_deleted: false,
            created_by: 'u-host',
            created_at: '2026-11-20T10:07:00.000Z',
            updated_at: '2026-11-20T10:07:00.000Z',
          },
        ],
      },
    ];

    const recap = buildRoomRecapData({
      room,
      members,
      blocks,
      pollTallies: [
        {
          item_id: 'opt-xss',
          block_id: 'blk-p',
          vote_count: 2,
          my_voted: true,
          voter_ids: ['u-host', 'u-b'],
        },
      ],
    });

    const html = renderRecapHtml(recap);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('#F97316');
    expect(html).toContain('#FFF7ED');
    expect(html).toContain('#18181B');
    // Must not contain any unescaped <script> tags or raw user-injected <img tag
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img ');
    expect(html).toContain('&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;');
    expect(html).toContain('选项 &lt;script&gt;evil()&lt;/script&gt; &amp; &quot;&#39;');
    expect(html).toContain('任务 &lt;script&gt;t()&lt;/script&gt; &amp; &quot;&#39;');
    expect(html).toContain('地点 &lt;script&gt;loc()&lt;/script&gt; &amp; &quot;&#39;');
    expect(html).toContain('账单 &lt;script&gt;e()&lt;/script&gt; &amp; &quot;&#39;');
    // Structured sections present
    expect(html).toContain('投票结论');
    expect(html).toContain('分工完成度');
    expect(html).toContain('最终日程轴');
    expect(html).toContain('费用与 AA 结算');
  });

  it('keeps canExportRecap === true for archived rooms across all active member roles while blocking all writes (Review Focus #4)', () => {
    const roles: MemberRole[] = ['host', 'admin', 'member'];
    for (const role of roles) {
      const p = computeRoomPermissions({
        role,
        roomStatus: 'archived',
        currentUserId: 'user-1',
        allowMemberCreatePoll: true,
      });

      expect(p.isArchived).toBe(true);
      expect(p.isReadOnly).toBe(true);
      expect(p.canViewRoom).toBe(true);
      expect(p.canExportRecap).toBe(true);

      // Every write capability must be blocked in archived rooms
      expect(p.canVote).toBe(false);
      expect(p.canClaimTask).toBe(false);
      expect(p.canComment).toBe(false);
      expect(p.canManageBlocks).toBe(false);
      expect(p.canCreatePollBlock).toBe(false);
      expect(p.canLockPoll).toBe(false);
      expect(p.canCreateItem(true)).toBe(false);
      expect(p.canEditOrDeleteItem('user-1')).toBe(false);
      expect(p.canSetTaskStatus('user-1', ['user-1'])).toBe(false);
      expect(p.canManageTaskImages('user-1', ['user-1'])).toBe(false);
      expect(p.canReviewMembers).toBe(false);
      expect(p.canKickMembers).toBe(false);
      expect(p.canResetRoomCode).toBe(false);
      expect(p.canRestoreDeletedItem).toBe(false);
      expect(p.canManageAdmins).toBe(false);
      expect(p.canArchiveRoom).toBe(false);
      expect(p.canEditRoomSettings).toBe(false);
    }
  });
});
