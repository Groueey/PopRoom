/** Minimal expense entry required to compute AA balances and transfers. */
export interface ExpenseInput {
  amount: number;
  paidByUserId: string;
  participantIds: string[];
}

/** Net balance in integer cents for a single room member (`> 0` receivable, `< 0` payable). */
export interface MemberBalance {
  userId: string;
  netCents: number;
}

/** Minimal settlement transfer from a debtor (`fromUserId`) to a creditor (`toUserId`). */
export interface TransferRecord {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

/** Combined AA settlement output for an expense list. */
export interface MinimalTransferSummary {
  balances: MemberBalance[];
  transfers: TransferRecord[];
  totalSpentCents: number;
}

interface PendingParty {
  userId: string;
  amountCents: number;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  HKD: 'HK$',
};

function accumulateExpenses(expenses: readonly ExpenseInput[]): {
  netByUser: Map<string, number>;
  totalSpentCents: number;
} {
  const netByUser = new Map<string, number>();
  let totalSpentCents = 0;

  for (const exp of expenses) {
    const validParticipants = exp.participantIds.filter(
      (id) => typeof id === 'string' && id.trim().length > 0,
    );
    const participantCount = validParticipants.length;
    if (!Number.isFinite(exp.amount) || participantCount === 0) {
      continue;
    }

    const cents = Math.round(exp.amount * 100);
    if (cents <= 0) {
      continue;
    }

    totalSpentCents += cents;
    netByUser.set(
      exp.paidByUserId,
      (netByUser.get(exp.paidByUserId) ?? 0) + cents,
    );

    const baseShare = Math.floor(cents / participantCount);
    const remainder = cents % participantCount;

    // Distribute remainder (+1 cent) deterministically to the first `remainder` entries
    // so total debits equal `cents` and all member net balances strictly sum to 0.
    for (let i = 0; i < participantCount; i += 1) {
      const participantId = validParticipants[i];
      if (!participantId) {
        continue;
      }
      const share = baseShare + (i < remainder ? 1 : 0);
      netByUser.set(participantId, (netByUser.get(participantId) ?? 0) - share);
    }
  }

  return { netByUser, totalSpentCents };
}

function toSortedBalances(netByUser: Map<string, number>): MemberBalance[] {
  const balances: MemberBalance[] = [];
  for (const [userId, rawNet] of netByUser.entries()) {
    const netCents = rawNet === 0 ? 0 : rawNet;
    balances.push({ userId, netCents });
  }
  balances.sort((a, b) => b.netCents - a.netCents || a.userId.localeCompare(b.userId));
  return balances;
}

/**
 * Computes net integer-cent balances per participant across all valid expenses.
 * The sum of `netCents` across all returned members is guaranteed to be `0`.
 */
export function computeExpenseBalances(expenses: ExpenseInput[]): MemberBalance[] {
  const { netByUser } = accumulateExpenses(expenses);
  return toSortedBalances(netByUser);
}

/**
 * Computes net balances and a greedy minimal transfer plan using a two-pointer
 * match over sorted creditors and debtors.
 */
export function computeMinimalTransfers(
  expenses: ExpenseInput[],
): MinimalTransferSummary {
  const { netByUser, totalSpentCents } = accumulateExpenses(expenses);
  const balances = toSortedBalances(netByUser);

  const creditors: PendingParty[] = [];
  const debtors: PendingParty[] = [];

  for (const balance of balances) {
    if (balance.netCents > 0) {
      creditors.push({ userId: balance.userId, amountCents: balance.netCents });
    } else if (balance.netCents < 0) {
      debtors.push({ userId: balance.userId, amountCents: -balance.netCents });
    }
  }

  // Largest-first ordering keeps settlement deterministic and minimizes fragmented transfers.
  creditors.sort(
    (a, b) => b.amountCents - a.amountCents || a.userId.localeCompare(b.userId),
  );
  debtors.sort(
    (a, b) => b.amountCents - a.amountCents || a.userId.localeCompare(b.userId),
  );

  const transfers: TransferRecord[] = [];
  let debtorIdx = 0;
  let creditorIdx = 0;

  while (debtorIdx < debtors.length && creditorIdx < creditors.length) {
    const debtor = debtors[debtorIdx];
    const creditor = creditors[creditorIdx];
    if (!debtor || !creditor) {
      break;
    }

    const settleCents = Math.min(debtor.amountCents, creditor.amountCents);
    if (settleCents > 0 && debtor.userId !== creditor.userId) {
      transfers.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountCents: settleCents,
      });
    }

    debtor.amountCents -= settleCents;
    creditor.amountCents -= settleCents;

    if (debtor.amountCents === 0) {
      debtorIdx += 1;
    }
    if (creditor.amountCents === 0) {
      creditorIdx += 1;
    }
  }

  return { balances, transfers, totalSpentCents };
}

/** Formats an integer-cent value into a human-readable currency string (e.g. `¥100.00`). */
export function formatCents(cents: number, currency = 'CNY'): string {
  const normalized = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = normalized < 0 ? '-' : '';
  const absCents = Math.abs(normalized);
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${sign}${symbol}${(absCents / 100).toFixed(2)}`;
}
