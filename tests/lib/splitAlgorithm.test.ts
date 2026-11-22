import { describe, expect, it } from 'vitest';
import {
  computeExpenseBalances,
  computeMinimalTransfers,
  formatCents,
  type ExpenseInput,
} from '@/src/lib/splitAlgorithm';

describe('splitAlgorithm (Review Focus #2)', () => {
  it('splits 100.00 CNY paid by A among [A, B, C] with deterministic remainder and zero-sum conservation', () => {
    const expenses: ExpenseInput[] = [
      {
        amount: 100,
        paidByUserId: 'A',
        participantIds: ['A', 'B', 'C'],
      },
    ];

    const result = computeMinimalTransfers(expenses);
    const byUser = new Map(result.balances.map((b) => [b.userId, b.netCents]));

    expect(result.totalSpentCents).toBe(10000);
    expect(byUser.get('A')).toBe(6666);
    expect(byUser.get('B')).toBe(-3333);
    expect(byUser.get('C')).toBe(-3333);

    const sum = result.balances.reduce((acc, b) => acc + b.netCents, 0);
    expect(sum).toBe(0);

    expect(result.transfers).toHaveLength(2);
    const transferSum = result.transfers.reduce((acc, t) => acc + t.amountCents, 0);
    expect(transferSum).toBe(6666);
    expect(result.transfers).toEqual(
      expect.arrayContaining([
        { fromUserId: 'B', toUserId: 'A', amountCents: 3333 },
        { fromUserId: 'C', toUserId: 'A', amountCents: 3333 },
      ]),
    );
    for (const t of result.transfers) {
      expect(t.fromUserId).not.toBe(t.toUserId);
      expect(t.amountCents).toBeGreaterThan(0);
    }
  });

  it('distributes remainder r (+1 cent) to the first r entries in participantIds deterministically', () => {
    const expenses: ExpenseInput[] = [
      {
        amount: 10,
        paidByUserId: 'P',
        participantIds: ['U1', 'U2', 'U3'],
      },
    ];

    const balances = computeExpenseBalances(expenses);
    const byUser = new Map(balances.map((b) => [b.userId, b.netCents]));

    // 1000 cents / 3 = 333 remainder 1 -> U1 pays 334, U2 pays 333, U3 pays 333
    expect(byUser.get('P')).toBe(1000);
    expect(byUser.get('U1')).toBe(-334);
    expect(byUser.get('U2')).toBe(-333);
    expect(byUser.get('U3')).toBe(-333);
    expect(balances.reduce((acc, b) => acc + b.netCents, 0)).toBe(0);
  });

  it('handles 0.01 CNY paid by A among [A, B, C] with zero-sum conservation and no zero/negative transfers', () => {
    const expenses: ExpenseInput[] = [
      {
        amount: 0.01,
        paidByUserId: 'A',
        participantIds: ['A', 'B', 'C'],
      },
    ];

    const result = computeMinimalTransfers(expenses);
    const byUser = new Map(result.balances.map((b) => [b.userId, b.netCents]));

    expect(result.totalSpentCents).toBe(1);
    expect(byUser.get('A')).toBe(0);
    expect(byUser.get('B')).toBe(0);
    expect(byUser.get('C')).toBe(0);
    expect(result.balances.reduce((acc, b) => acc + b.netCents, 0)).toBe(0);
    expect(result.transfers).toEqual([]);
  });

  it('handles payer D not included in participantIds [A, B]', () => {
    const expenses: ExpenseInput[] = [
      {
        amount: 60,
        paidByUserId: 'D',
        participantIds: ['A', 'B'],
      },
    ];

    const result = computeMinimalTransfers(expenses);
    const byUser = new Map(result.balances.map((b) => [b.userId, b.netCents]));

    expect(result.totalSpentCents).toBe(6000);
    expect(byUser.get('D')).toBe(6000);
    expect(byUser.get('A')).toBe(-3000);
    expect(byUser.get('B')).toBe(-3000);
    expect(result.transfers).toEqual(
      expect.arrayContaining([
        { fromUserId: 'A', toUserId: 'D', amountCents: 3000 },
        { fromUserId: 'B', toUserId: 'D', amountCents: 3000 },
      ]),
    );
    expect(result.transfers).toHaveLength(2);
  });

  it('minimizes multi-expense chain to 2 transfers instead of pairwise mesh', () => {
    const expenses: ExpenseInput[] = [
      { amount: 90, paidByUserId: 'A', participantIds: ['A', 'B', 'C'] },
      { amount: 30, paidByUserId: 'B', participantIds: ['A', 'B', 'C'] },
    ];

    const result = computeMinimalTransfers(expenses);
    const byUser = new Map(result.balances.map((b) => [b.userId, b.netCents]));

    expect(result.totalSpentCents).toBe(12000);
    expect(byUser.get('A')).toBe(5000);
    expect(byUser.get('B')).toBe(-1000);
    expect(byUser.get('C')).toBe(-4000);

    expect(result.transfers).toHaveLength(2);
    expect(result.transfers).toEqual(
      expect.arrayContaining([
        { fromUserId: 'C', toUserId: 'A', amountCents: 4000 },
        { fromUserId: 'B', toUserId: 'A', amountCents: 1000 },
      ]),
    );
  });

  it('returns empty balances and transfers for empty expenses', () => {
    const result = computeMinimalTransfers([]);
    expect(result.balances).toEqual([]);
    expect(result.transfers).toEqual([]);
    expect(result.totalSpentCents).toBe(0);
  });

  it('filters empty participantIds before computing participantCount and remainder', () => {
    const result = computeMinimalTransfers([
      {
        amount: 100,
        paidByUserId: 'A',
        participantIds: ['', 'A', '   ', 'B'],
      },
    ]);
    const byUser = new Map(result.balances.map((b) => [b.userId, b.netCents]));

    expect(result.totalSpentCents).toBe(10000);
    expect(byUser.get('A')).toBe(5000);
    expect(byUser.get('B')).toBe(-5000);
    expect(result.balances.reduce((acc, b) => acc + b.netCents, 0)).toBe(0);
    expect(result.transfers).toEqual([
      { fromUserId: 'B', toUserId: 'A', amountCents: 5000 },
    ]);
  });

  it('formats integer cents into currency strings cleanly', () => {
    expect(formatCents(10000)).toBe('¥100.00');
    expect(formatCents(1)).toBe('¥0.01');
    expect(formatCents(0)).toBe('¥0.00');
    expect(formatCents(-3333)).toBe('-¥33.33');
    expect(formatCents(2550, 'USD')).toBe('$25.50');
  });
});
