import { describe, expect, it, vi } from 'vitest';
import { RoomApiError } from '@/src/api/roomHelpers';
import {
  applyBlockOrderToList,
  moveBlockInOrder,
  validateReorderBlockIds,
} from '@/src/lib/blockOrderHelpers';
import { executeShareWithFallback } from '@/src/lib/shareInvite';

describe('blockOrderHelpers', () => {
  describe('moveBlockInOrder', () => {
    it('moves a block up or down by swapping with its neighbor without mutating input', () => {
      const original = ['b1', 'b2', 'b3'];

      expect(moveBlockInOrder(original, 'b2', 'up')).toEqual(['b2', 'b1', 'b3']);
      expect(moveBlockInOrder(original, 'b2', 'down')).toEqual(['b1', 'b3', 'b2']);
      expect(original).toEqual(['b1', 'b2', 'b3']);
    });

    it('returns null when target is already at the boundary or not found', () => {
      const ids = ['b1', 'b2', 'b3'];

      expect(moveBlockInOrder(ids, 'b1', 'up')).toBeNull();
      expect(moveBlockInOrder(ids, 'b3', 'down')).toBeNull();
      expect(moveBlockInOrder(ids, 'missing', 'up')).toBeNull();
      expect(moveBlockInOrder([], 'b1', 'down')).toBeNull();
      expect(moveBlockInOrder(['only'], 'only', 'up')).toBeNull();
      expect(moveBlockInOrder(['only'], 'only', 'down')).toBeNull();
    });
  });

  describe('applyBlockOrderToList', () => {
    it('projects blocks into orderedIds sequence with fresh sort_order 0..N-1 without mutating input', () => {
      const b1 = { id: 'b1', sort_order: 0, title: '投票' };
      const b2 = { id: 'b2', sort_order: 1, title: '分工' };
      const b3 = { id: 'b3', sort_order: 2, title: '日程' };
      const blocks = [b1, b2, b3];

      const projected = applyBlockOrderToList(blocks, ['b3', 'b1', 'b2']);

      expect(projected).toEqual([
        { id: 'b3', sort_order: 0, title: '日程' },
        { id: 'b1', sort_order: 1, title: '投票' },
        { id: 'b2', sort_order: 2, title: '分工' },
      ]);
      expect(b1.sort_order).toBe(0);
      expect(b2.sort_order).toBe(1);
      expect(b3.sort_order).toBe(2);
    });

    it('appends omitted blocks in relative order and ignores unknown or duplicate IDs', () => {
      const blocks = [
        { id: 'b1', sort_order: 5 },
        { id: 'b2', sort_order: 10 },
        { id: 'b3', sort_order: 15 },
      ];

      const projected = applyBlockOrderToList(blocks, ['b3', 'unknown', 'b3']);

      expect(projected).toEqual([
        { id: 'b3', sort_order: 0 },
        { id: 'b1', sort_order: 1 },
        { id: 'b2', sort_order: 2 },
      ]);
    });
  });

  describe('validateReorderBlockIds', () => {
    it('returns trimmed IDs for valid non-empty unique arrays', () => {
      expect(validateReorderBlockIds([' b1 ', 'b2', 'b3'])).toEqual([
        'b1',
        'b2',
        'b3',
      ]);
    });

    it('rejects empty arrays, blank IDs, and duplicate IDs with RoomApiError(INVALID_INPUT)', () => {
      for (const badInput of [
        [],
        ['b1', ''],
        ['b1', '   '],
        ['b1', 'b2', 'b1'],
        ['b1', ' b1 '],
      ]) {
        expect(() => validateReorderBlockIds(badInput)).toThrow(RoomApiError);
        try {
          validateReorderBlockIds(badInput);
        } catch (err) {
          expect(err).toBeInstanceOf(RoomApiError);
          expect((err as RoomApiError).code).toBe('INVALID_INPUT');
          expect((err as RoomApiError).message).toBe('积木排序参数无效');
        }
      }
    });
  });
});

describe('shareInvite executeShareWithFallback', () => {
  it('returns "shared" when native share succeeds without calling copy', async () => {
    const share = vi.fn().mockResolvedValue({ action: 'sharedAction' });
    const copy = vi.fn().mockResolvedValue(true);

    const outcome = await executeShareWithFallback('邀请文案', '周末露营', {
      share,
      copy,
    });

    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledWith({
      title: '周末露营',
      message: '邀请文案',
    });
    expect(copy).not.toHaveBeenCalled();
  });

  it('returns "dismissed" when user cancels OS share sheet without falling back to copy', async () => {
    const share = vi.fn().mockResolvedValue({ action: 'dismissedAction' });
    const copy = vi.fn().mockResolvedValue(true);

    const outcome = await executeShareWithFallback('邀请文案', '周末露营', {
      share,
      copy,
    });

    expect(outcome).toBe('dismissed');
    expect(copy).not.toHaveBeenCalled();
  });

  it('falls back to clipboard copy and returns "copied" when native share throws', async () => {
    const share = vi.fn().mockRejectedValue(new Error('Share unavailable'));
    const copy = vi.fn().mockResolvedValue(true);

    const outcome = await executeShareWithFallback('邀请文案', '周末露营', {
      share,
      copy,
    });

    expect(outcome).toBe('copied');
    expect(copy).toHaveBeenCalledWith('邀请文案');
  });
});
