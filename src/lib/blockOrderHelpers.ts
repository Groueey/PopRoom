import { RoomApiError } from '../api/roomHelpers';

/** Direction for moving a block one slot relative to its neighbors. */
export type BlockMoveDirection = 'up' | 'down';

/**
 * Returns a new ordered ID array with `targetId` swapped with its neighbor,
 * or `null` if `targetId` is not found or already at the boundary.
 */
export function moveBlockInOrder(
  blockIds: readonly string[],
  targetId: string,
  direction: BlockMoveDirection,
): string[] | null {
  const index = blockIds.indexOf(targetId);
  if (index === -1) {
    return null;
  }

  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= blockIds.length) {
    return null;
  }

  const current = blockIds[index];
  const neighbor = blockIds[nextIndex];
  if (current === undefined || neighbor === undefined) {
    return null;
  }

  const next = blockIds.slice();
  next[index] = neighbor;
  next[nextIndex] = current;
  return next;
}

/**
 * Projects `blocks` into `orderedIds` sequence with fresh `sort_order: 0..N-1` without mutating input objects.
 * Any block omitted from `orderedIds` is appended at the end preserving relative order.
 */
export function applyBlockOrderToList<
  T extends { id: string; sort_order: number },
>(blocks: readonly T[], orderedIds: readonly string[]): T[] {
  const byId = new Map<string, T>();
  for (const block of blocks) {
    byId.set(block.id, block);
  }

  const ordered: T[] = [];
  const seen = new Set<string>();

  for (const id of orderedIds) {
    if (seen.has(id)) {
      continue;
    }
    const block = byId.get(id);
    if (!block) {
      continue;
    }
    seen.add(id);
    ordered.push(block);
  }

  for (const block of blocks) {
    if (!seen.has(block.id)) {
      seen.add(block.id);
      ordered.push(block);
    }
  }

  return ordered.map((block, index) => ({
    ...block,
    sort_order: index,
  }));
}

/**
 * Validates that `blockIds` is a non-empty array of unique non-blank IDs before calling `reorder_room_blocks`.
 */
export function validateReorderBlockIds(blockIds: readonly string[]): string[] {
  if (!Array.isArray(blockIds) || blockIds.length === 0) {
    throw new RoomApiError('INVALID_INPUT', '积木排序参数无效');
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawId of blockIds) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id || seen.has(id)) {
      throw new RoomApiError('INVALID_INPUT', '积木排序参数无效');
    }
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}
