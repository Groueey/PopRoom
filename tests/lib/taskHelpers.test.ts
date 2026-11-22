import { describe, expect, it } from 'vitest';
import {
  appendTaskImageUrl,
  applyOptimisticTaskClaim,
  applyOptimisticTaskStatus,
  computeTaskCompletionStats,
  parseTaskDueAtInput,
  removeTaskImageUrl,
} from '@/src/lib/taskHelpers';
import type { TaskItemData } from '@/src/schemas/blocks';

function makeTaskData(overrides: Partial<TaskItemData> = {}): TaskItemData {
  return {
    title: '购买露营饮用水',
    description: '每人 2 瓶矿泉水',
    status: 'unclaimed',
    assigneeIds: [],
    dueAt: null,
    imageUrls: [],
    ...overrides,
  };
}

describe('taskHelpers', () => {
  describe('applyOptimisticTaskClaim', () => {
    it('adds userId and transitions unclaimed task to in_progress', () => {
      const initial = makeTaskData({
        status: 'unclaimed',
        assigneeIds: [],
      });

      const next = applyOptimisticTaskClaim(initial, 'user-1');

      expect(initial.assigneeIds).toEqual([]);
      expect(initial.status).toBe('unclaimed');
      expect(next.assigneeIds).toEqual(['user-1']);
      expect(next.status).toBe('in_progress');
    });

    it('adds second assignee while keeping status in_progress', () => {
      const initial = makeTaskData({
        status: 'in_progress',
        assigneeIds: ['user-1'],
      });

      const next = applyOptimisticTaskClaim(initial, 'user-2');

      expect(next.assigneeIds).toEqual(['user-1', 'user-2']);
      expect(next.status).toBe('in_progress');
    });

    it('unclaiming when another assignee remains keeps status in_progress', () => {
      const initial = makeTaskData({
        status: 'in_progress',
        assigneeIds: ['user-1', 'user-2'],
      });

      const next = applyOptimisticTaskClaim(initial, 'user-1');

      expect(next.assigneeIds).toEqual(['user-2']);
      expect(next.status).toBe('in_progress');
    });

    it('unclaiming the last assignee transitions in_progress back to unclaimed', () => {
      const initial = makeTaskData({
        status: 'in_progress',
        assigneeIds: ['user-1'],
      });

      const next = applyOptimisticTaskClaim(initial, 'user-1');

      expect(next.assigneeIds).toEqual([]);
      expect(next.status).toBe('unclaimed');
    });

    it('unclaiming the last assignee leaves status done unchanged if already done', () => {
      const initial = makeTaskData({
        status: 'done',
        assigneeIds: ['user-1'],
      });

      const next = applyOptimisticTaskClaim(initial, 'user-1');

      expect(next.assigneeIds).toEqual([]);
      expect(next.status).toBe('done');
    });

    it('claiming a done task adds userId and leaves status done unchanged', () => {
      const initial = makeTaskData({
        status: 'done',
        assigneeIds: [],
      });

      const next = applyOptimisticTaskClaim(initial, 'user-2');

      expect(next.assigneeIds).toEqual(['user-2']);
      expect(next.status).toBe('done');
    });
  });

  describe('applyOptimisticTaskStatus', () => {
    it('updates task status immutably while preserving assignees and images', () => {
      const initial = makeTaskData({
        status: 'in_progress',
        assigneeIds: ['user-1'],
        imageUrls: ['https://example.com/1.jpg'],
      });

      const next = applyOptimisticTaskStatus(initial, 'done');

      expect(initial.status).toBe('in_progress');
      expect(next.status).toBe('done');
      expect(next.assigneeIds).toEqual(['user-1']);
      expect(next.imageUrls).toEqual(['https://example.com/1.jpg']);
    });
  });

  describe('appendTaskImageUrl & removeTaskImageUrl', () => {
    it('appends up to 3 URLs without mutating existing array', () => {
      const step0: string[] = [];
      const step1 = appendTaskImageUrl(step0, 'https://example.com/a.jpg');
      const step2 = appendTaskImageUrl(step1, 'https://example.com/b.jpg');
      const step3 = appendTaskImageUrl(step2, 'https://example.com/c.jpg');

      expect(step0).toEqual([]);
      expect(step1).toEqual(['https://example.com/a.jpg']);
      expect(step2).toEqual([
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
      ]);
      expect(step3).toEqual([
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
      ]);
    });

    it('throws MAX_IMAGES_EXCEEDED on a 4th URL', () => {
      const existing = [
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
      ];

      expect(() =>
        appendTaskImageUrl(existing, 'https://example.com/d.jpg'),
      ).toThrow('MAX_IMAGES_EXCEEDED');
    });

    it('removeTaskImageUrl removes only the target URL', () => {
      const existing = [
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
      ];

      const next = removeTaskImageUrl(existing, 'https://example.com/b.jpg');

      expect(existing).toHaveLength(3);
      expect(next).toEqual([
        'https://example.com/a.jpg',
        'https://example.com/c.jpg',
      ]);
    });
  });

  describe('computeTaskCompletionStats & parseTaskDueAtInput', () => {
    it('computes task counts accurately across statuses', () => {
      const stats = computeTaskCompletionStats([
        { data: makeTaskData({ status: 'done' }) },
        { data: makeTaskData({ status: 'in_progress' }) },
        { data: makeTaskData({ status: 'unclaimed' }) },
        { data: makeTaskData({ status: 'done' }) },
      ]);

      expect(stats).toEqual({
        total: 4,
        done: 2,
        inProgress: 1,
        unclaimed: 1,
      });
    });

    it('returns null for empty due date and ISO string for valid due date', () => {
      expect(parseTaskDueAtInput('')).toBeNull();
      expect(parseTaskDueAtInput('   ')).toBeNull();

      const parsedDate = parseTaskDueAtInput('2026-11-28');
      expect(parsedDate).toMatch(/^2026-11-/);

      const parsedDateTime = parseTaskDueAtInput('2026-11-28 14:30');
      expect(parsedDateTime).not.toBeNull();
      expect(Number.isNaN(Date.parse(parsedDateTime ?? ''))).toBe(false);
    });

    it('throws on invalid due date input', () => {
      expect(() => parseTaskDueAtInput('2026-02-30')).toThrow();
      expect(() => parseTaskDueAtInput('not-a-date')).toThrow();
    });
  });
});
