import { describe, expect, it } from 'vitest';
import type { ParsedBlockItem } from '@/src/api/blockHelpers';
import {
  DEFAULT_SCHEDULE_GROUP_LABEL,
  formatScheduleTimeRange,
  groupAndSortScheduleItems,
  normalizeScheduleTimeInput,
} from '@/src/lib/scheduleHelpers';
import type { ScheduleItemData } from '@/src/schemas/blocks';

function makeScheduleItem(
  id: string,
  dataOverrides: Partial<ScheduleItemData> = {},
  itemOverrides: Partial<Omit<ParsedBlockItem<'schedule'>, 'data' | 'type'>> = {},
): ParsedBlockItem<'schedule'> {
  return {
    id,
    block_id: 'block-schedule-1',
    room_id: 'room-1',
    type: 'schedule',
    data: {
      groupLabel: 'Day 1',
      startTime: '09:00',
      title: `日程 ${id}`,
      ownerId: null,
      notes: '',
      ...dataOverrides,
    },
    sort_order: 0,
    is_deleted: false,
    created_by: 'user-1',
    created_at: '2026-11-20T08:00:00.000Z',
    updated_at: '2026-11-20T08:00:00.000Z',
    ...itemOverrides,
  };
}

describe('scheduleHelpers', () => {
  describe('groupAndSortScheduleItems', () => {
    it('returns an empty array for empty input', () => {
      expect(groupAndSortScheduleItems([])).toEqual([]);
    });

    it('groups items by groupLabel preserving first-seen group order and defaults empty labels to 活动当天', () => {
      const items: ParsedBlockItem<'schedule'>[] = [
        makeScheduleItem('1', { groupLabel: 'Day 2', startTime: '10:00' }),
        makeScheduleItem('2', { groupLabel: '', startTime: '09:00' }),
        makeScheduleItem('3', { groupLabel: 'Day 1', startTime: '08:00' }),
        makeScheduleItem('4', { groupLabel: 'Day 2', startTime: '08:30' }),
        makeScheduleItem('5', { groupLabel: '   ', startTime: '14:00' }),
        makeScheduleItem('6', { groupLabel: '活动当天', startTime: '11:00' }),
      ];
      const snapshotIds = items.map((item) => item.id);

      const groups = groupAndSortScheduleItems(items);

      expect(items.map((item) => item.id)).toEqual(snapshotIds);
      expect(groups.map((group) => group.groupLabel)).toEqual([
        'Day 2',
        DEFAULT_SCHEDULE_GROUP_LABEL,
        'Day 1',
      ]);
      expect(groups[0]?.items.map((item) => item.id)).toEqual(['4', '1']);
      expect(groups[1]?.items.map((item) => item.id)).toEqual(['2', '6', '5']);
      expect(groups[2]?.items.map((item) => item.id)).toEqual(['3']);
    });

    it('sorts HH:mm strings ascending including single-digit hours and uses sort_order as tie-breaker', () => {
      const items: ParsedBlockItem<'schedule'>[] = [
        makeScheduleItem(
          'late',
          { groupLabel: 'Day 1', startTime: '14:30' },
          { sort_order: 0 },
        ),
        makeScheduleItem(
          'morning-b',
          { groupLabel: 'Day 1', startTime: '09:00' },
          { sort_order: 3 },
        ),
        makeScheduleItem(
          'morning-mid',
          { groupLabel: 'Day 1', startTime: '9:15' },
          { sort_order: 1 },
        ),
        makeScheduleItem(
          'morning-a',
          { groupLabel: 'Day 1', startTime: '9:00' },
          { sort_order: 1 },
        ),
      ];

      const groups = groupAndSortScheduleItems(items);

      expect(groups).toHaveLength(1);
      expect(groups[0]?.items.map((item) => item.id)).toEqual([
        'morning-a',
        'morning-b',
        'morning-mid',
        'late',
      ]);
    });

    it('sorts ISO timestamp startTime strings ascending across timezone offsets with sort_order tie-breaker', () => {
      const items: ParsedBlockItem<'schedule'>[] = [
        makeScheduleItem(
          'iso-latest',
          { groupLabel: '行程', startTime: '2026-11-28T14:30:00.000Z' },
          { sort_order: 0 },
        ),
        makeScheduleItem(
          'iso-tie-2',
          { groupLabel: '行程', startTime: '2026-11-28T09:00:00.000Z' },
          { sort_order: 5 },
        ),
        makeScheduleItem(
          'iso-earliest-offset',
          { groupLabel: '行程', startTime: '2026-11-28T11:15:00+08:00' },
          { sort_order: 10 },
        ),
        makeScheduleItem(
          'iso-tie-1',
          { groupLabel: '行程', startTime: '2026-11-28T09:00:00.000Z' },
          { sort_order: 2 },
        ),
      ];

      const groups = groupAndSortScheduleItems(items);

      expect(groups).toHaveLength(1);
      expect(groups[0]?.items.map((item) => item.id)).toEqual([
        'iso-earliest-offset',
        'iso-tie-1',
        'iso-tie-2',
        'iso-latest',
      ]);
    });
  });

  describe('time normalization and formatting', () => {
    it('normalizes HH:mm time strings and accepts valid ISO timestamps', () => {
      expect(normalizeScheduleTimeInput('9:5')).toBeNull();
      expect(normalizeScheduleTimeInput('9:05')).toBe('09:05');
      expect(normalizeScheduleTimeInput(' 14:30 ')).toBe('14:30');
      expect(normalizeScheduleTimeInput('25:00')).toBeNull();
      expect(normalizeScheduleTimeInput('2026-11-28T09:00:00.000Z')).toBe(
        '2026-11-28T09:00:00.000Z',
      );
    });

    it('formats start and optional end times cleanly', () => {
      expect(formatScheduleTimeRange('9:00', '11:30')).toBe('09:00 - 11:30');
      expect(formatScheduleTimeRange('09:00')).toBe('09:00');
    });
  });
});
