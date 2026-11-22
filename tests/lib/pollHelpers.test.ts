import { describe, expect, it } from 'vitest';
import type { ParsedBlockItem } from '@/src/api/blocks';
import {
  applyOptimisticPollToggle,
  buildAvailabilityMatrix,
  collectAvailabilityDates,
  formatAvailabilityDateLabel,
  formatPollPercentage,
  getHeatmapTier,
  getUpcomingDateStrings,
  isValidCalendarDate,
  sanitizePollTallyForDisplay,
} from '@/src/lib/pollHelpers';
import type { PollTally, PollTimeSlot } from '@/src/schemas/blocks';

function makePollItem(
  id: string,
  blockId: string,
  slotDate: string,
  slotPeriod: PollTimeSlot,
): ParsedBlockItem<'poll'> {
  return {
    id,
    block_id: blockId,
    room_id: 'room-1',
    type: 'poll',
    data: {
      label: `${slotDate} ${slotPeriod}`,
      slotDate,
      slotPeriod,
    },
    sort_order: 0,
    is_deleted: false,
    created_by: 'user-1',
    created_at: '2026-11-22T00:00:00.000Z',
    updated_at: '2026-11-22T00:00:00.000Z',
  };
}

describe('pollHelpers', () => {
  describe('applyOptimisticPollToggle', () => {
    it('switches my_voted from item A to item B in single-choice mode and updates counts/voters immutably', () => {
      const initial: PollTally[] = [
        {
          item_id: 'item-a',
          block_id: 'block-1',
          vote_count: 2,
          my_voted: true,
          voter_ids: ['user-other', 'user-me'],
        },
        {
          item_id: 'item-b',
          block_id: 'block-1',
          vote_count: 1,
          my_voted: false,
          voter_ids: ['user-3'],
        },
        {
          item_id: 'item-other-block',
          block_id: 'block-2',
          vote_count: 1,
          my_voted: true,
          voter_ids: ['user-me'],
        },
      ];

      const next = applyOptimisticPollToggle(
        initial,
        'item-b',
        'block-1',
        false,
        'user-me',
        false,
      );

      // Original array remains unchanged
      expect(initial[0]?.vote_count).toBe(2);
      expect(initial[0]?.my_voted).toBe(true);

      const a = next.find((t) => t.item_id === 'item-a');
      const b = next.find((t) => t.item_id === 'item-b');
      const other = next.find((t) => t.item_id === 'item-other-block');

      expect(a).toEqual({
        item_id: 'item-a',
        block_id: 'block-1',
        vote_count: 1,
        my_voted: false,
        voter_ids: ['user-other'],
      });
      expect(b).toEqual({
        item_id: 'item-b',
        block_id: 'block-1',
        vote_count: 2,
        my_voted: true,
        voter_ids: ['user-3', 'user-me'],
      });
      expect(other).toEqual({
        item_id: 'item-other-block',
        block_id: 'block-2',
        vote_count: 1,
        my_voted: true,
        voter_ids: ['user-me'],
      });
    });

    it('toggles an already-voted item off in single-choice mode', () => {
      const initial: PollTally[] = [
        {
          item_id: 'item-a',
          block_id: 'block-1',
          vote_count: 1,
          my_voted: true,
          voter_ids: ['user-me'],
        },
      ];

      const next = applyOptimisticPollToggle(
        initial,
        'item-a',
        'block-1',
        false,
        'user-me',
        false,
      );

      expect(next).toEqual([
        {
          item_id: 'item-a',
          block_id: 'block-1',
          vote_count: 0,
          my_voted: false,
          voter_ids: [],
        },
      ]);
    });

    it('keeps item A voted while adding item B in multi-choice mode', () => {
      const initial: PollTally[] = [
        {
          item_id: 'item-a',
          block_id: 'block-1',
          vote_count: 1,
          my_voted: true,
          voter_ids: ['user-me'],
        },
        {
          item_id: 'item-b',
          block_id: 'block-1',
          vote_count: 0,
          my_voted: false,
          voter_ids: [],
        },
      ];

      const next = applyOptimisticPollToggle(
        initial,
        'item-b',
        'block-1',
        true,
        'user-me',
        false,
      );

      expect(next.find((t) => t.item_id === 'item-a')).toEqual({
        item_id: 'item-a',
        block_id: 'block-1',
        vote_count: 1,
        my_voted: true,
        voter_ids: ['user-me'],
      });
      expect(next.find((t) => t.item_id === 'item-b')).toEqual({
        item_id: 'item-b',
        block_id: 'block-1',
        vote_count: 1,
        my_voted: true,
        voter_ids: ['user-me'],
      });

      // Clicking item A toggles it off without clearing item B
      const toggledOff = applyOptimisticPollToggle(
        next,
        'item-a',
        'block-1',
        true,
        'user-me',
        false,
      );
      expect(toggledOff.find((t) => t.item_id === 'item-a')?.my_voted).toBe(false);
      expect(toggledOff.find((t) => t.item_id === 'item-b')?.my_voted).toBe(true);
    });

    it('creates a tally entry when voting on a newly added option missing from cache and strips voter_ids when anonymous', () => {
      const initial: PollTally[] = [
        {
          item_id: 'item-a',
          block_id: 'block-1',
          vote_count: 1,
          my_voted: true,
          voter_ids: ['stale-id'],
        },
      ];

      const next = applyOptimisticPollToggle(
        initial,
        'item-new',
        'block-1',
        false,
        'user-me',
        true,
      );

      expect(next.find((t) => t.item_id === 'item-a')).toEqual({
        item_id: 'item-a',
        block_id: 'block-1',
        vote_count: 0,
        my_voted: false,
        voter_ids: [],
      });
      expect(next.find((t) => t.item_id === 'item-new')).toEqual({
        item_id: 'item-new',
        block_id: 'block-1',
        vote_count: 1,
        my_voted: true,
        voter_ids: [],
      });
    });
  });

  describe('sanitizePollTallyForDisplay (Review Focus #3)', () => {
    it('strips voter_ids to [] whenever anonymous is true even if raw cache contains IDs', () => {
      const raw: PollTally = {
        item_id: 'item-1',
        block_id: 'block-1',
        vote_count: 3,
        my_voted: true,
        voter_ids: ['u1', 'u2', 'u3'],
      };

      const sanitized = sanitizePollTallyForDisplay(raw, true);

      expect(sanitized.voter_ids).toEqual([]);
      expect(sanitized.vote_count).toBe(3);
      expect(sanitized.my_voted).toBe(true);
      // Original is not mutated
      expect(raw.voter_ids).toEqual(['u1', 'u2', 'u3']);
    });

    it('preserves voter_ids when anonymous is false', () => {
      const raw: PollTally = {
        item_id: 'item-1',
        block_id: 'block-1',
        vote_count: 2,
        my_voted: false,
        voter_ids: ['u1', 'u2'],
      };

      const sanitized = sanitizePollTallyForDisplay(raw, false);

      expect(sanitized.voter_ids).toEqual(['u1', 'u2']);
      expect(sanitized).not.toBe(raw);
    });
  });

  describe('buildAvailabilityMatrix', () => {
    const dates = ['2026-11-28', '2026-11-29'];
    const slots: PollTimeSlot[] = ['morning', 'afternoon', 'evening'];

    it('computes ratio = voteCount / totalActiveMembers and identifies tied topItemIds when maxVotes > 0', () => {
      const items: ParsedBlockItem<'poll'>[] = [
        makePollItem('i-1', 'b-1', '2026-11-28', 'morning'),
        makePollItem('i-2', 'b-1', '2026-11-28', 'afternoon'),
        makePollItem('i-3', 'b-1', '2026-11-29', 'evening'),
      ];

      const tallies = new Map<string, PollTally>([
        [
          'i-1',
          {
            item_id: 'i-1',
            block_id: 'b-1',
            vote_count: 3,
            my_voted: true,
            voter_ids: ['u1', 'u2', 'u3'],
          },
        ],
        [
          'i-2',
          {
            item_id: 'i-2',
            block_id: 'b-1',
            vote_count: 1,
            my_voted: false,
            voter_ids: ['u2'],
          },
        ],
        [
          'i-3',
          {
            item_id: 'i-3',
            block_id: 'b-1',
            vote_count: 3,
            my_voted: false,
            voter_ids: ['u1', 'u3', 'u4'],
          },
        ],
      ]);

      const matrix = buildAvailabilityMatrix(dates, slots, items, tallies, 4);

      expect(matrix.maxVotes).toBe(3);
      expect(matrix.topItemIds).toEqual(['i-1', 'i-3']);
      expect(matrix.cells).toHaveLength(6);

      const morning28 = matrix.cells.find(
        (c) => c.date === '2026-11-28' && c.slot === 'morning',
      );
      const afternoon28 = matrix.cells.find(
        (c) => c.date === '2026-11-28' && c.slot === 'afternoon',
      );
      const evening28 = matrix.cells.find(
        (c) => c.date === '2026-11-28' && c.slot === 'evening',
      );

      expect(morning28).toMatchObject({
        itemId: 'i-1',
        voteCount: 3,
        myVoted: true,
        ratio: 0.75,
        isTop: true,
      });
      expect(afternoon28).toMatchObject({
        itemId: 'i-2',
        voteCount: 1,
        myVoted: false,
        ratio: 0.25,
        isTop: false,
      });
      expect(evening28).toMatchObject({
        item: null,
        itemId: null,
        voteCount: 0,
        myVoted: false,
        ratio: 0,
        isTop: false,
      });
    });

    it('returns ratio = 0 safely when totalActiveMembers === 0 and empty topItemIds when zero votes exist', () => {
      const items: ParsedBlockItem<'poll'>[] = [
        makePollItem('i-1', 'b-1', '2026-11-28', 'morning'),
      ];
      const tallies = new Map<string, PollTally>([
        [
          'i-1',
          {
            item_id: 'i-1',
            block_id: 'b-1',
            vote_count: 0,
            my_voted: false,
            voter_ids: [],
          },
        ],
      ]);

      const zeroVotesMatrix = buildAvailabilityMatrix(
        dates,
        slots,
        items,
        tallies,
        5,
      );
      expect(zeroVotesMatrix.maxVotes).toBe(0);
      expect(zeroVotesMatrix.topItemIds).toEqual([]);
      expect(zeroVotesMatrix.cells.every((c) => c.isTop === false)).toBe(true);

      const zeroMembersMatrix = buildAvailabilityMatrix(
        dates,
        slots,
        items,
        new Map([
          [
            'i-1',
            {
              item_id: 'i-1',
              block_id: 'b-1',
              vote_count: 2,
              my_voted: true,
              voter_ids: ['u1', 'u2'],
            },
          ],
        ]),
        0,
      );
      const cell = zeroMembersMatrix.cells.find((c) => c.itemId === 'i-1');
      expect(cell?.ratio).toBe(0);
    });
  });

  describe('additional poll display helpers', () => {
    it('collectAvailabilityDates merges config dates and item slotDates sorted and deduplicated', () => {
      const items = [
        makePollItem('i-1', 'b-1', '2026-11-30', 'morning'),
        makePollItem('i-2', 'b-1', '2026-11-28', 'evening'),
      ];
      const dates = collectAvailabilityDates(
        ['2026-11-29', '2026-11-28'],
        items,
      );
      expect(dates).toEqual(['2026-11-28', '2026-11-29', '2026-11-30']);
    });

    it('computes heatmap tiers and percentages cleanly', () => {
      expect(getHeatmapTier(0)).toBe(0);
      expect(getHeatmapTier(0.2)).toBe(1);
      expect(getHeatmapTier(0.4)).toBe(2);
      expect(getHeatmapTier(0.65)).toBe(3);
      expect(getHeatmapTier(0.9)).toBe(4);

      expect(formatPollPercentage(0, 0)).toBe(0);
      expect(formatPollPercentage(1, 3)).toBe(33);
      expect(formatPollPercentage(2, 2)).toBe(100);
    });

    it('validates and formats availability calendar dates deterministically', () => {
      expect(isValidCalendarDate('2026-11-28')).toBe(true);
      expect(isValidCalendarDate('2026-02-30')).toBe(false);
      expect(isValidCalendarDate('not-a-date')).toBe(false);

      expect(formatAvailabilityDateLabel('2026-11-28')).toEqual({
        shortDate: '11/28',
        weekday: '周六',
      });
      expect(getUpcomingDateStrings(3, new Date(2026, 10, 29))).toEqual([
        '2026-11-29',
        '2026-11-30',
        '2026-12-01',
      ]);
    });
  });
});
