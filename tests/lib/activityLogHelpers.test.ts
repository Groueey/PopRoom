import { describe, expect, it } from 'vitest';
import {
  canRestoreLogEntry,
  filterActivityLogs,
  formatActivityLogEntry,
  formatActivityLogTimestamp,
} from '@/src/lib/activityLogHelpers';
import type { ActivityLogRow } from '@/src/types/database';

function makeLog(overrides: Partial<ActivityLogRow> = {}): ActivityLogRow {
  return {
    id: 'log-1',
    room_id: 'room-1',
    actor_id: 'user-1',
    action: 'delete_item',
    target_table: 'block_items',
    target_id: 'item-1',
    before_snapshot: {
      id: 'item-1',
      block_id: 'block-1',
      room_id: 'room-1',
      data: {
        title: '购买露营饮用水',
        description: '每人两瓶矿泉水',
        status: 'in_progress',
      },
      sort_order: 0,
      is_deleted: false,
      created_by: 'user-2',
      created_at: '2026-11-20T08:00:00.000Z',
      updated_at: '2026-11-20T08:00:00.000Z',
    },
    restored_at: null,
    created_at: '2026-11-22T07:30:00.000Z',
    ...overrides,
  };
}

describe('activityLogHelpers', () => {
  describe('canRestoreLogEntry', () => {
    it('returns true for unrestored delete_item on block_items when canUndoDelete is true', () => {
      const log = makeLog({
        action: 'delete_item',
        target_table: 'block_items',
        restored_at: null,
      });

      expect(canRestoreLogEntry(log, true)).toBe(true);
    });

    it('returns false when restored_at is already set', () => {
      const log = makeLog({
        action: 'delete_item',
        target_table: 'block_items',
        restored_at: '2026-11-22T07:40:00.000Z',
      });

      expect(canRestoreLogEntry(log, true)).toBe(false);
    });

    it('returns false when room is archived or user cannot undo (canUndoDelete === false)', () => {
      const log = makeLog({
        action: 'delete_item',
        target_table: 'block_items',
        restored_at: null,
      });

      expect(canRestoreLogEntry(log, false)).toBe(false);
    });

    it('returns false for non-restorable actions or non-block_items target tables', () => {
      expect(
        canRestoreLogEntry(
          makeLog({ action: 'restore_item', restored_at: null }),
          true,
        ),
      ).toBe(false);
      expect(
        canRestoreLogEntry(
          makeLog({
            action: 'kick_member',
            target_table: 'room_members',
            restored_at: null,
          }),
          true,
        ),
      ).toBe(false);
      expect(
        canRestoreLogEntry(
          makeLog({
            action: 'update_room',
            target_table: 'rooms',
            restored_at: null,
          }),
          true,
        ),
      ).toBe(false);
      expect(
        canRestoreLogEntry(
          makeLog({
            action: 'delete_item',
            target_table: 'blocks',
            restored_at: null,
          }),
          true,
        ),
      ).toBe(false);
    });
  });

  describe('formatActivityLogEntry', () => {
    it('formats unrestored delete_item with task title and marks canRestore true', () => {
      const log = makeLog();
      const formatted = formatActivityLogEntry(log, '小橘', true);

      expect(formatted).toEqual({
        id: 'log-1',
        summary: '小橘 删除了「购买露营饮用水」',
        detail: expect.stringContaining('每人两瓶矿泉水'),
        canRestore: true,
        isRestored: false,
        createdAt: '2026-11-22T07:30:00.000Z',
      });
    });

    it('extracts poll option label and expense amount from before_snapshot.data', () => {
      const pollLog = makeLog({
        id: 'log-poll',
        before_snapshot: {
          id: 'item-poll',
          data: {
            label: '周六上午 10:00',
            slotDate: '2026-11-28',
            slotPeriod: 'morning',
          },
        },
      });
      const formattedPoll = formatActivityLogEntry(pollLog, '阿哲', true);
      expect(formattedPoll.summary).toContain('阿哲');
      expect(formattedPoll.summary).toContain('周六上午 10:00');
      expect(formattedPoll.canRestore).toBe(true);

      const expenseLog = makeLog({
        id: 'log-expense',
        before_snapshot: {
          id: 'item-exp',
          data: {
            title: '露营食材采购',
            amount: 128.5,
            paidByUserId: 'user-1',
            participantIds: ['user-1', 'user-2'],
          },
        },
      });
      const formattedExpense = formatActivityLogEntry(expenseLog, '阿哲', true);
      expect(formattedExpense.summary).toContain('露营食材采购');
      expect(formattedExpense.detail).toContain('128.50');
    });

    it('sets canRestore false and isRestored true when restored_at is non-null', () => {
      const log = makeLog({
        restored_at: '2026-11-22T07:45:00.000Z',
      });

      const formatted = formatActivityLogEntry(log, '小橘', true);

      expect(formatted.canRestore).toBe(false);
      expect(formatted.isRestored).toBe(true);
      expect(formatted.summary).toContain('小橘');
      expect(formatted.summary).toContain('购买露营饮用水');
    });

    it('sets canRestore false when room is archived (canUndoDelete === false)', () => {
      const log = makeLog({ restored_at: null });

      const formatted = formatActivityLogEntry(log, '小橘', false);

      expect(formatted.canRestore).toBe(false);
      expect(formatted.isRestored).toBe(false);
    });

    it('handles restore_item, kick_member, and update_room with full, partial, or null snapshots', () => {
      const restoreFull = formatActivityLogEntry(
        makeLog({
          id: 'log-r1',
          action: 'restore_item',
          before_snapshot: {
            data: { title: '集合地点：北门' },
          },
        }),
        '房主',
        true,
      );
      expect(restoreFull.canRestore).toBe(false);
      expect(restoreFull.isRestored).toBe(false);
      expect(restoreFull.summary).toContain('房主');
      expect(restoreFull.summary).toContain('集合地点：北门');

      const restoreNull = formatActivityLogEntry(
        makeLog({
          id: 'log-r2',
          action: 'restore_item',
          before_snapshot: null,
        }),
        '房主',
        true,
      );
      expect(restoreNull.canRestore).toBe(false);
      expect(restoreNull.summary).toContain('房主');
      expect(restoreNull.detail.length).toBeGreaterThan(0);

      const kickMember = formatActivityLogEntry(
        makeLog({
          id: 'log-k1',
          action: 'kick_member',
          target_table: 'room_members',
          before_snapshot: {
            id: 'rm-1',
            room_id: 'room-1',
            user_id: 'user-9',
            role: 'admin',
            status: 'active',
          },
        }),
        '房主',
        true,
      );
      expect(kickMember.canRestore).toBe(false);
      expect(kickMember.isRestored).toBe(false);
      expect(kickMember.summary).toContain('房主');
      expect(kickMember.detail).toContain('管理员');

      const kickNull = formatActivityLogEntry(
        makeLog({
          id: 'log-k2',
          action: 'kick_member',
          target_table: 'room_members',
          before_snapshot: null,
        }),
        '',
        true,
      );
      expect(kickNull.canRestore).toBe(false);
      expect(kickNull.summary.length).toBeGreaterThan(0);
      expect(kickNull.detail.length).toBeGreaterThan(0);

      const updateRoomPartial = formatActivityLogEntry(
        makeLog({
          id: 'log-u1',
          action: 'update_room',
          target_table: 'rooms',
          before_snapshot: {
            title: '周末露营计划',
            join_mode: 'approval',
          },
        }),
        '管理员A',
        true,
      );
      expect(updateRoomPartial.canRestore).toBe(false);
      expect(updateRoomPartial.summary).toContain('管理员A');
      expect(updateRoomPartial.detail).toContain('周末露营计划');

      const updateRoomNull = formatActivityLogEntry(
        makeLog({
          id: 'log-u2',
          action: 'update_room',
          target_table: 'rooms',
          before_snapshot: null,
        }),
        '管理员A',
        true,
      );
      expect(updateRoomNull.canRestore).toBe(false);
      expect(updateRoomNull.summary).toContain('管理员A');
      expect(updateRoomNull.detail.length).toBeGreaterThan(0);
    });

    it('gracefully handles delete_item with partial or null before_snapshot', () => {
      const partialTopLevel = formatActivityLogEntry(
        makeLog({
          before_snapshot: { title: '直接标题字段' },
        }),
        '小橘',
        true,
      );
      expect(partialTopLevel.summary).toBe('小橘 删除了「直接标题字段」');

      const emptySnapshot = formatActivityLogEntry(
        makeLog({
          before_snapshot: null,
        }),
        '小橘',
        true,
      );
      expect(emptySnapshot.summary).toContain('小橘');
      expect(emptySnapshot.detail.length).toBeGreaterThan(0);
      expect(emptySnapshot.canRestore).toBe(true);
    });
  });

  describe('filterActivityLogs & formatActivityLogTimestamp', () => {
    it('filters restorable delete_item entries when mode is restorable', () => {
      const logs: ActivityLogRow[] = [
        makeLog({ id: 'l1', action: 'delete_item', restored_at: null }),
        makeLog({
          id: 'l2',
          action: 'delete_item',
          restored_at: '2026-11-22T07:45:00.000Z',
        }),
        makeLog({
          id: 'l3',
          action: 'kick_member',
          target_table: 'room_members',
        }),
      ];

      expect(filterActivityLogs(logs, 'all', true).map((l) => l.id)).toEqual([
        'l1',
        'l2',
        'l3',
      ]);
      expect(
        filterActivityLogs(logs, 'restorable', true).map((l) => l.id),
      ).toEqual(['l1']);
      expect(
        filterActivityLogs(logs, 'restorable', false).map((l) => l.id),
      ).toEqual([]);
    });

    it('formats valid ISO timestamps and handles invalid timestamps safely', () => {
      const formatted = formatActivityLogTimestamp('2026-11-22T07:30:00.000Z');
      expect(formatted).toMatch(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
      expect(formatActivityLogTimestamp('invalid-date')).toBe('未知时间');
    });
  });
});
