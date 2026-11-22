import { parseBlockConfig } from '../schemas/blocks';
import type { PollTally, TaskStatus } from '../schemas/blocks';
import { validateReorderBlockIds } from '../lib/blockOrderHelpers';
import { supabase } from '../lib/supabase';
import type {
  ActivityLogRow,
  BlockItemRow,
  BlockRow,
  BlockType,
  ItemCommentRow,
  ItemCommentWithProfile,
  ProfileSummary,
} from '../types/database';
import {
  type ActivityLogWithActor,
  type CreateBlockInputBase,
  type CreateBlockItemInputBase,
  type ParsedBlock,
  type ParsedBlockBase,
  type ParsedBlockItemBase,
  type UpdateBlockConfigInputBase,
  type UpdateBlockItemInputBase,
  parseBlockRowsSafely,
  parsePollTalliesSafely,
  parseSingleBlockItem,
  validateCommentContent,
  validateCreateBlockInput,
  validateCreateBlockItemInput,
  validateTaskImagesInput,
  validateTaskStatusInput,
  validateUpdateBlockConfigInput,
  validateUpdateBlockItemInput,
} from './blockHelpers';
import { RoomApiError, mapRoomError, toRoomApiError } from './roomHelpers';

export * from './blockHelpers';

const BLOCK_COLUMNS =
  'id, room_id, type, title, sort_order, config, created_by, created_at, updated_at';

const BLOCK_ITEM_COLUMNS =
  'id, block_id, room_id, data, sort_order, is_deleted, created_by, created_at, updated_at';

const COMMENT_COLUMNS =
  'id, item_id, room_id, user_id, content, created_at, profiles(id, nickname, avatar_color, avatar_url)';

const ACTIVITY_LOG_COLUMNS =
  'id, room_id, actor_id, action, target_table, target_id, before_snapshot, restored_at, created_at, profiles(id, nickname, avatar_color, avatar_url)';

interface RawCommentWithProfileRow extends ItemCommentRow {
  profiles: ProfileSummary | ProfileSummary[] | null;
}

interface RawActivityLogWithActorRow extends ActivityLogRow {
  profiles: ProfileSummary | ProfileSummary[] | null;
}

function normalizeProfileSummary(
  raw: ProfileSummary | ProfileSummary[] | null,
): ProfileSummary | null {
  if (!raw) {
    return null;
  }
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function mapMutationError(error: unknown): RoomApiError {
  if (
    error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'PGRST116'
  ) {
    return new RoomApiError('ITEM_NOT_FOUND', mapRoomError('ITEM_NOT_FOUND'));
  }
  return toRoomApiError(error);
}

async function getCurrentSessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

async function resolveNextBlockSortOrder(roomId: string): Promise<number> {
  const { data, error } = await supabase
    .from('blocks')
    .select('sort_order')
    .eq('room_id', roomId)
    .order('sort_order', { ascending: false })
    .limit(1);

  if (error) {
    throw toRoomApiError(error);
  }

  const top = (data as Array<{ sort_order: number }> | null)?.[0];
  return top ? top.sort_order + 1 : 0;
}

async function resolveNextItemSortOrder(blockId: string): Promise<number> {
  const { data, error } = await supabase
    .from('block_items')
    .select('sort_order')
    .eq('block_id', blockId)
    .eq('is_deleted', false)
    .order('sort_order', { ascending: false })
    .limit(1);

  if (error) {
    throw toRoomApiError(error);
  }

  const top = (data as Array<{ sort_order: number }> | null)?.[0];
  return top ? top.sort_order + 1 : 0;
}

/** Fetches all blocks and active (`is_deleted = false`) items for a room and parses them safely via Zod. */
export async function fetchRoomBlocksWithItems(
  roomId: string,
): Promise<ParsedBlock[]> {
  const [blocksResult, itemsResult] = await Promise.all([
    supabase
      .from('blocks')
      .select(BLOCK_COLUMNS)
      .eq('room_id', roomId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('block_items')
      .select(BLOCK_ITEM_COLUMNS)
      .eq('room_id', roomId)
      .eq('is_deleted', false)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);

  if (blocksResult.error) {
    throw toRoomApiError(blocksResult.error);
  }
  if (itemsResult.error) {
    throw toRoomApiError(itemsResult.error);
  }

  return parseBlockRowsSafely(
    (blocksResult.data ?? []) as BlockRow[],
    (itemsResult.data ?? []) as BlockItemRow[],
  );
}

/** Fetches aggregated, anonymity-safe poll tallies for every poll item in a room via `get_room_poll_tallies`. */
export async function fetchRoomPollTallies(
  roomId: string,
): Promise<PollTally[]> {
  const { data, error } = await supabase.rpc('get_room_poll_tallies', {
    p_room_id: roomId,
  });

  if (error) {
    throw toRoomApiError(error);
  }

  return parsePollTalliesSafely(Array.isArray(data) ? data : []);
}

/** Toggles the current user's vote on a poll item and returns updated tallies for the parent poll block. */
export async function togglePollVote(itemId: string): Promise<PollTally[]> {
  const { data, error } = await supabase.rpc('toggle_poll_vote', {
    p_item_id: itemId,
  });

  if (error) {
    throw toRoomApiError(error);
  }

  return parsePollTalliesSafely(Array.isArray(data) ? data : []);
}

/** Atomically claims or unclaims a task item for the current user via `toggle_task_claim`. */
export async function toggleTaskClaim(
  itemId: string,
): Promise<ParsedBlockItemBase<'task'>> {
  const { data, error } = await supabase.rpc('toggle_task_claim', {
    p_item_id: itemId,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('ITEM_NOT_FOUND', mapRoomError('ITEM_NOT_FOUND'));
  }

  return parseSingleBlockItem('task', data as BlockItemRow);
}

/** Updates a task item's lifecycle status via `set_task_status` RPC (creator, assignee, or admin/host). */
export async function setTaskStatus(
  itemId: string,
  status: TaskStatus,
): Promise<ParsedBlockItemBase<'task'>> {
  const validatedStatus = validateTaskStatusInput(status);
  const { data, error } = await supabase.rpc('set_task_status', {
    p_item_id: itemId,
    p_status: validatedStatus,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('ITEM_NOT_FOUND', mapRoomError('ITEM_NOT_FOUND'));
  }

  return parseSingleBlockItem('task', data as BlockItemRow);
}

/** Updates up to 3 image URLs on a task item via `update_task_images` RPC. */
export async function updateTaskImages(
  itemId: string,
  imageUrls: readonly string[],
): Promise<ParsedBlockItemBase<'task'>> {
  const validatedUrls = validateTaskImagesInput(imageUrls);
  const { data, error } = await supabase.rpc('update_task_images', {
    p_item_id: itemId,
    p_image_urls: validatedUrls,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('ITEM_NOT_FOUND', mapRoomError('ITEM_NOT_FOUND'));
  }

  return parseSingleBlockItem('task', data as BlockItemRow);
}

/** Creates a new collaborative block after Zod validation of `config`. */
export async function createBlock<T extends BlockType>(
  input: CreateBlockInputBase<T>,
): Promise<ParsedBlockBase<T>> {
  const validated = validateCreateBlockInput(input);
  const sortOrder =
    validated.sortOrder ?? (await resolveNextBlockSortOrder(validated.roomId));
  const createdBy =
    validated.createdBy !== undefined
      ? validated.createdBy
      : await getCurrentSessionUserId();

  const { data, error } = await supabase
    .from('blocks')
    .insert({
      room_id: validated.roomId,
      type: validated.type,
      title: validated.title,
      sort_order: sortOrder,
      config: validated.config,
      created_by: createdBy,
    })
    .select(BLOCK_COLUMNS)
    .single();

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('UNKNOWN_ERROR', mapRoomError('UNKNOWN_ERROR'));
  }

  const row = data as BlockRow;
  const parsedConfig = parseBlockConfig(validated.type, row.config);

  return {
    id: row.id,
    room_id: row.room_id,
    type: validated.type,
    title: row.title,
    sort_order: row.sort_order,
    config: parsedConfig,
    items: [],
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Updates a block's Zod-validated `config` (and optional `title`).
 * Note: returns the updated block record with `items: []`; callers should invalidate `roomBlocks(roomId)`
 * or preserve existing items in optimistic cache.
 */
export async function updateBlockConfig<T extends BlockType>(
  input: UpdateBlockConfigInputBase<T>,
): Promise<ParsedBlockBase<T>> {
  const validated = validateUpdateBlockConfigInput(input);
  const patch: {
    config: typeof validated.config;
    title?: string;
  } = {
    config: validated.config,
  };

  if (validated.title !== undefined) {
    patch.title = validated.title;
  }

  const { data, error } = await supabase
    .from('blocks')
    .update(patch)
    .eq('id', validated.blockId)
    .select(BLOCK_COLUMNS)
    .single();

  if (error) {
    throw mapMutationError(error);
  }
  if (!data) {
    throw new RoomApiError('ITEM_NOT_FOUND', mapRoomError('ITEM_NOT_FOUND'));
  }

  const row = data as BlockRow;
  const parsedConfig = parseBlockConfig(validated.type, row.config);

  return {
    id: row.id,
    room_id: row.room_id,
    type: validated.type,
    title: row.title,
    sort_order: row.sort_order,
    config: parsedConfig,
    items: [],
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Deletes a collaborative block and cascades its child items (host/admin on active rooms only). */
export async function deleteBlock(blockId: string): Promise<void> {
  const { error } = await supabase.from('blocks').delete().eq('id', blockId);

  if (error) {
    throw toRoomApiError(error);
  }
}

/** Persists a complete room block ordering via `reorder_room_blocks` RPC (host/admin on active rooms only). */
export async function reorderRoomBlocks(
  roomId: string,
  blockIds: readonly string[],
): Promise<void> {
  const trimmedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
  if (!trimmedRoomId) {
    throw new RoomApiError('INVALID_INPUT', '积木排序参数无效');
  }

  const validated = validateReorderBlockIds(blockIds);
  const { error } = await supabase.rpc('reorder_room_blocks', {
    p_room_id: trimmedRoomId,
    p_block_ids: validated,
  });

  if (error) {
    throw toRoomApiError(error);
  }
}

/** Creates a Zod-validated `block_items` row inside the target block. */
export async function createBlockItem<T extends BlockType>(
  input: CreateBlockItemInputBase<T>,
): Promise<ParsedBlockItemBase<T>> {
  const validated = validateCreateBlockItemInput(input);
  const sortOrder =
    validated.sortOrder ?? (await resolveNextItemSortOrder(validated.blockId));
  const createdBy =
    validated.createdBy !== undefined
      ? validated.createdBy
      : await getCurrentSessionUserId();

  const { data, error } = await supabase
    .from('block_items')
    .insert({
      block_id: validated.blockId,
      room_id: validated.roomId,
      data: validated.data,
      sort_order: sortOrder,
      created_by: createdBy,
    })
    .select(BLOCK_ITEM_COLUMNS)
    .single();

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('UNKNOWN_ERROR', mapRoomError('UNKNOWN_ERROR'));
  }

  return parseSingleBlockItem(validated.type, data as BlockItemRow);
}

/** Updates an active (`is_deleted = false`) `block_items` row after Zod validation. */
export async function updateBlockItem<T extends BlockType>(
  input: UpdateBlockItemInputBase<T>,
): Promise<ParsedBlockItemBase<T>> {
  const validated = validateUpdateBlockItemInput(input);
  const patch: {
    data: typeof validated.data;
    sort_order?: number;
  } = {
    data: validated.data,
  };

  if (validated.sortOrder !== undefined) {
    patch.sort_order = validated.sortOrder;
  }

  const { data, error } = await supabase
    .from('block_items')
    .update(patch)
    .eq('id', validated.itemId)
    .eq('is_deleted', false)
    .select(BLOCK_ITEM_COLUMNS)
    .single();

  if (error) {
    throw mapMutationError(error);
  }
  if (!data) {
    throw new RoomApiError('ITEM_NOT_FOUND', mapRoomError('ITEM_NOT_FOUND'));
  }

  return parseSingleBlockItem(validated.type, data as BlockItemRow);
}

/** Soft-deletes a block item via `soft_delete_block_item` RPC and returns the audit `activity_logs.id`. */
export async function softDeleteBlockItem(itemId: string): Promise<string> {
  const { data, error } = await supabase.rpc('soft_delete_block_item', {
    p_item_id: itemId,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (typeof data !== 'string' || !data) {
    throw new RoomApiError('UNKNOWN_ERROR', mapRoomError('UNKNOWN_ERROR'));
  }

  return data;
}

/** Restores a soft-deleted block item from an audit log entry via `restore_deleted_item` RPC. */
export async function restoreDeletedItem(logId: string): Promise<BlockItemRow> {
  const { data, error } = await supabase.rpc('restore_deleted_item', {
    p_log_id: logId,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('ITEM_NOT_FOUND', mapRoomError('ITEM_NOT_FOUND'));
  }

  return data as BlockItemRow;
}

/** Fetches lightweight comments for a block item ordered chronologically with author profiles. */
export async function fetchItemComments(
  itemId: string,
): Promise<ItemCommentWithProfile[]> {
  const { data, error } = await supabase
    .from('item_comments')
    .select(COMMENT_COLUMNS)
    .eq('item_id', itemId)
    .order('created_at', { ascending: true });

  if (error) {
    throw toRoomApiError(error);
  }

  const rows = (data ?? []) as unknown as RawCommentWithProfileRow[];
  return rows.map((row) => ({
    id: row.id,
    item_id: row.item_id,
    room_id: row.room_id,
    user_id: row.user_id,
    content: row.content,
    created_at: row.created_at,
    profiles: normalizeProfileSummary(row.profiles),
  }));
}

/** Posts a lightweight comment on an active block item in an active room. */
export async function createItemComment(
  itemId: string,
  roomId: string,
  content: string,
  userId?: string,
): Promise<ItemCommentWithProfile> {
  const validatedContent = validateCommentContent(content);
  const activeUserId = userId ?? (await getCurrentSessionUserId());

  if (!activeUserId) {
    throw new RoomApiError(
      'NOT_AUTHENTICATED',
      mapRoomError('NOT_AUTHENTICATED'),
    );
  }

  const { data, error } = await supabase
    .from('item_comments')
    .insert({
      item_id: itemId,
      room_id: roomId,
      user_id: activeUserId,
      content: validatedContent,
    })
    .select(COMMENT_COLUMNS)
    .single();

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('UNKNOWN_ERROR', mapRoomError('UNKNOWN_ERROR'));
  }

  const row = data as unknown as RawCommentWithProfileRow;
  return {
    id: row.id,
    item_id: row.item_id,
    room_id: row.room_id,
    user_id: row.user_id,
    content: row.content,
    created_at: row.created_at,
    profiles: normalizeProfileSummary(row.profiles),
  };
}

/** Fetches room audit logs (visible to host/admin via RLS) ordered newest first. */
export async function fetchActivityLogs(
  roomId: string,
): Promise<ActivityLogWithActor[]> {
  const { data, error } = await supabase
    .from('activity_logs')
    .select(ACTIVITY_LOG_COLUMNS)
    .eq('room_id', roomId)
    .order('created_at', { ascending: false });

  if (error) {
    throw toRoomApiError(error);
  }

  const rows = (data ?? []) as unknown as RawActivityLogWithActorRow[];
  return rows.map((row) => ({
    id: row.id,
    room_id: row.room_id,
    actor_id: row.actor_id,
    action: row.action,
    target_table: row.target_table,
    target_id: row.target_id,
    before_snapshot: row.before_snapshot,
    restored_at: row.restored_at,
    created_at: row.created_at,
    profiles: normalizeProfileSummary(row.profiles),
  }));
}
