import { describe, expect, it } from 'vitest';
import type { RoomRow, PollTallyRow } from '../src/types/database';

describe('toolchain and core database types', () => {
  it('supports strict RoomRow and PollTallyRow contracts', () => {
    const tally: PollTallyRow = {
      item_id: '00000000-0000-0000-0000-000000000001',
      block_id: '00000000-0000-0000-0000-000000000002',
      vote_count: 3,
      my_voted: true,
      voter_ids: [],
    };
    const status: RoomRow['status'] = 'active';
    expect(tally.vote_count).toBe(3);
    expect(status).toBe('active');
  });
});
