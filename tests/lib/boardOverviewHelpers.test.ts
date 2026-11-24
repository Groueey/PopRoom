import { describe, expect, it } from 'vitest';
import type { ParsedBlock } from '../../src/api/blocks';
import {
  buildBlockOverviewSummary,
  collectBoardPendingActions,
  selectRecentChatPreviewMessages,
} from '../../src/lib/boardOverviewHelpers';
import type { ParsedRoomMessage } from '../../src/lib/chatHelpers';
import type { PollTally } from '../../src/schemas/blocks';

const baseBlock = {
  room_id: 'room-1',
  sort_order: 0,
  created_by: 'user-1',
  created_at: '2026-11-22T08:00:00.000Z',
  updated_at: '2026-11-22T08:00:00.000Z',
};

describe('boardOverviewHelpers', () => {
  it('summarizes an option poll with the leading choice and total votes', () => {
    const pollBlock: ParsedBlock<'poll'> = {
      ...baseBlock,
      id: 'poll-1',
      type: 'poll',
      title: '营地选址投票',
      config: {
        mode: 'option',
        multiple: false,
        anonymous: false,
        allowAddOption: true,
        deadline: null,
        isLocked: false,
      },
      items: [
        {
          id: 'opt-1',
          block_id: 'poll-1',
          room_id: 'room-1',
          type: 'poll',
          data: { label: '莫干山仙潭村' },
          sort_order: 0,
          created_by: 'user-1',
          created_at: '2026-11-22T08:00:00.000Z',
          updated_at: '2026-11-22T08:00:00.000Z',
          is_deleted: false,
        },
        {
          id: 'opt-2',
          block_id: 'poll-1',
          room_id: 'room-1',
          type: 'poll',
          data: { label: '安吉小杭坑' },
          sort_order: 1,
          created_by: 'user-1',
          created_at: '2026-11-22T08:00:00.000Z',
          updated_at: '2026-11-22T08:00:00.000Z',
          is_deleted: false,
        },
      ],
    };

    const tallies: PollTally[] = [
      {
        block_id: 'poll-1',
        item_id: 'opt-1',
        vote_count: 4,
        voter_ids: ['u1', 'u2', 'u3', 'u4'],
        my_voted: true,
      },
      {
        block_id: 'poll-1',
        item_id: 'opt-2',
        vote_count: 2,
        voter_ids: ['u5', 'u6'],
        my_voted: false,
      },
    ];

    const summary = buildBlockOverviewSummary(pollBlock, tallies);
    expect(summary.statText).toBe('6 票');
    expect(summary.conclusion).toContain('莫干山仙潭村');
    expect(summary.conclusion).toContain('4 票');
    expect(summary.preview?.kind).toBe('poll_options');
    if (summary.preview?.kind === 'poll_options') {
      expect(summary.preview.options).toHaveLength(2);
      expect(summary.preview.options[0]?.label).toBe('莫干山仙潭村');
      expect(summary.preview.options[0]?.percent).toBe(67);
    }
  });

  it('summarizes task completion stats and progress ratio', () => {
    const taskBlock: ParsedBlock<'task'> = {
      ...baseBlock,
      id: 'task-1',
      type: 'task',
      title: '行前物资分工',
      config: { allowMemberCreate: true },
      items: [
        {
          id: 't1',
          block_id: 'task-1',
          room_id: 'room-1',
          type: 'task',
          data: {
            title: '天幕和帐篷',
            description: '',
            status: 'done',
            assigneeIds: ['u1'],
            dueAt: null,
            imageUrls: [],
          },
          sort_order: 0,
          created_by: 'u1',
          created_at: '2026-11-22T08:00:00.000Z',
          updated_at: '2026-11-22T08:00:00.000Z',
          is_deleted: false,
        },
        {
          id: 't2',
          block_id: 'task-1',
          room_id: 'room-1',
          type: 'task',
          data: {
            title: '急救包与驱蚊液',
            description: '',
            status: 'unclaimed',
            assigneeIds: [],
            dueAt: null,
            imageUrls: [],
          },
          sort_order: 1,
          created_by: 'u1',
          created_at: '2026-11-22T08:00:00.000Z',
          updated_at: '2026-11-22T08:00:00.000Z',
          is_deleted: false,
        },
      ],
    };

    const summary = buildBlockOverviewSummary(taskBlock);
    expect(summary.statText).toBe('1/2 完成');
    expect(summary.progressPercent).toBe(50);
    expect(summary.conclusion).toContain('1 项待认领');

    const actions = collectBoardPendingActions({
      blocks: [taskBlock],
      talliesByBlockId: new Map(),
      currentUserId: 'u2',
      isReadOnly: false,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe('task');
    expect(actions[0]?.ctaLabel).toBe('去认领');
  });

  it('omits pending actions when the room is read-only', () => {
    const taskBlock: ParsedBlock<'task'> = {
      ...baseBlock,
      id: 'task-2',
      type: 'task',
      title: '物资分工',
      config: { allowMemberCreate: true },
      items: [
        {
          id: 't3',
          block_id: 'task-2',
          room_id: 'room-1',
          type: 'task',
          data: {
            title: '冰块',
            description: '',
            status: 'unclaimed',
            assigneeIds: [],
            dueAt: null,
            imageUrls: [],
          },
          sort_order: 0,
          created_by: 'u1',
          created_at: '2026-11-22T08:00:00.000Z',
          updated_at: '2026-11-22T08:00:00.000Z',
          is_deleted: false,
        },
      ],
    };

    const actions = collectBoardPendingActions({
      blocks: [taskBlock],
      talliesByBlockId: new Map(),
      currentUserId: 'u2',
      isReadOnly: true,
    });
    expect(actions).toEqual([]);
  });

  it('builds schedule mini-timeline previews and filters recent chat messages', () => {
    const scheduleBlock: ParsedBlock<'schedule'> = {
      ...baseBlock,
      id: 'sched-1',
      type: 'schedule',
      title: '活动日程轴',
      config: { groupBy: 'day' },
      items: [
        {
          id: 's1',
          block_id: 'sched-1',
          room_id: 'room-1',
          type: 'schedule',
          data: {
            groupLabel: 'Day 1',
            startTime: '09:00',
            title: '东门集合',
            locationName: '紫金港东门',
            ownerId: null,
            notes: '',
          },
          sort_order: 0,
          created_by: 'u1',
          created_at: '2026-11-22T08:00:00.000Z',
          updated_at: '2026-11-22T08:00:00.000Z',
          is_deleted: false,
        },
        {
          id: 's2',
          block_id: 'sched-1',
          room_id: 'room-1',
          type: 'schedule',
          data: {
            groupLabel: 'Day 1',
            startTime: '11:30',
            title: '营地搭帐篷',
            ownerId: null,
            notes: '',
          },
          sort_order: 1,
          created_by: 'u1',
          created_at: '2026-11-22T08:01:00.000Z',
          updated_at: '2026-11-22T08:01:00.000Z',
          is_deleted: false,
        },
        {
          id: 's3',
          block_id: 'sched-1',
          room_id: 'room-1',
          type: 'schedule',
          data: {
            groupLabel: 'Day 1',
            startTime: '18:30',
            title: '炭火烧烤',
            ownerId: null,
            notes: '',
          },
          sort_order: 2,
          created_by: 'u1',
          created_at: '2026-11-22T08:02:00.000Z',
          updated_at: '2026-11-22T08:02:00.000Z',
          is_deleted: false,
        },
      ],
    };

    const summary = buildBlockOverviewSummary(scheduleBlock);
    expect(summary.preview?.kind).toBe('schedule');
    if (summary.preview?.kind === 'schedule') {
      expect(summary.preview.nodes).toHaveLength(2);
      expect(summary.preview.nodes[0]?.time).toBe('09:00');
      expect(summary.preview.remainingCount).toBe(1);
    }

    const fakeMsgs: ParsedRoomMessage[] = [
      {
        id: 'm1',
        room_id: 'room-1',
        sender_id: 'u1',
        msg_type: 'text',
        content: '第一条消息',
        metadata: { mentionAll: false, mentionUserIds: [] },
        is_deleted: false,
        created_at: '2026-11-23T10:00:00.000Z',
        profiles: null,
      },
      {
        id: 'm2',
        room_id: 'room-1',
        sender_id: 'blocked-user',
        msg_type: 'text',
        content: '被屏蔽消息',
        metadata: { mentionAll: false, mentionUserIds: [] },
        is_deleted: false,
        created_at: '2026-11-23T10:01:00.000Z',
        profiles: null,
      },
      {
        id: 'm3',
        room_id: 'room-1',
        sender_id: 'u2',
        msg_type: 'text',
        content: '最新消息',
        metadata: { mentionAll: false, mentionUserIds: [] },
        is_deleted: false,
        created_at: '2026-11-23T10:02:00.000Z',
        profiles: null,
      },
    ];

    const recent = selectRecentChatPreviewMessages(
      fakeMsgs,
      new Set(['blocked-user']),
      2,
    );
    expect(recent.map((m) => m.id)).toEqual(['m1', 'm3']);
  });
});
