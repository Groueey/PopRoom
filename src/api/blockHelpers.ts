import { ZodError } from 'zod';
import {
  type BlockConfigMap,
  type BlockItemDataMap,
  type PollTally,
  PollTallySchema,
  TaskStatusSchema,
  parseBlockConfig,
  parseBlockItemData,
} from '../schemas/blocks';
import type {
  ActivityLogRow,
  BlockItemRow,
  BlockRow,
  BlockType,
  ProfileSummary,
} from '../types/database';
import { RoomApiError, mapRoomError } from './roomHelpers';

/** Maximum character length allowed for block titles. */
export const MAX_BLOCK_TITLE_LENGTH = 40;

/** Maximum image attachments allowed per task item (matches SQL RPC `update_task_images`). */
export const MAX_TASK_IMAGES = 3;

/** Maximum length allowed for lightweight item comments. */
export const MAX_COMMENT_LENGTH = 500;

/** Ordered list of all supported collaborative block types. */
export const VALID_BLOCK_TYPES: readonly BlockType[] = [
  'poll',
  'task',
  'schedule',
  'expense',
];

/** Human-readable Chinese labels for each block type. */
export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  poll: '投票决策',
  task: '分工认领',
  schedule: '日程轴',
  expense: '费用 AA / 预算',
};

/** Validated `block_items` row with Zod-parsed `data` narrowed to `BlockType`. */
export interface ParsedBlockItemBase<T extends BlockType = BlockType> {
  id: string;
  block_id: string;
  room_id: string;
  type: T;
  data: BlockItemDataMap[T];
  sort_order: number;
  is_deleted: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Discriminated union of Zod-validated block items. */
export type ParsedBlockItem<T extends BlockType = BlockType> = T extends BlockType
  ? ParsedBlockItemBase<T>
  : never;

/** Validated `blocks` row pairing Zod-parsed `config` with validated child items. */
export interface ParsedBlockBase<T extends BlockType = BlockType> {
  id: string;
  room_id: string;
  type: T;
  title: string;
  sort_order: number;
  config: BlockConfigMap[T];
  items: ParsedBlockItemBase<T>[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Discriminated union of Zod-validated blocks enabling exhaustive `switch (block.type)` narrowing. */
export type ParsedBlock<T extends BlockType = BlockType> = T extends BlockType
  ? ParsedBlockBase<T>
  : never;

/** Activity log row enriched with the actor's public profile summary when available. */
export interface ActivityLogWithActor extends ActivityLogRow {
  profiles: ProfileSummary | null;
}

/** Generic base payload for `createBlock`. */
export interface CreateBlockInputBase<T extends BlockType = BlockType> {
  roomId: string;
  type: T;
  title: string;
  config: BlockConfigMap[T];
  sortOrder?: number;
  createdBy?: string | null;
}

/** Typed discriminated input payload for `createBlock`. */
export type CreateBlockInput<T extends BlockType = BlockType> = T extends BlockType
  ? CreateBlockInputBase<T>
  : never;

/** Generic base payload for `updateBlockConfig`. */
export interface UpdateBlockConfigInputBase<T extends BlockType = BlockType> {
  blockId: string;
  type: T;
  config: BlockConfigMap[T];
  title?: string;
}

/** Typed discriminated input payload for `updateBlockConfig`. */
export type UpdateBlockConfigInput<T extends BlockType = BlockType> =
  T extends BlockType ? UpdateBlockConfigInputBase<T> : never;

/** Generic base payload for `createBlockItem`. */
export interface CreateBlockItemInputBase<T extends BlockType = BlockType> {
  blockId: string;
  roomId: string;
  type: T;
  data: BlockItemDataMap[T];
  sortOrder?: number;
  createdBy?: string | null;
}

/** Typed discriminated input payload for `createBlockItem`. */
export type CreateBlockItemInput<T extends BlockType = BlockType> =
  T extends BlockType ? CreateBlockItemInputBase<T> : never;

/** Generic base payload for `updateBlockItem`. */
export interface UpdateBlockItemInputBase<T extends BlockType = BlockType> {
  itemId: string;
  type: T;
  data: BlockItemDataMap[T];
  sortOrder?: number;
}

/** Typed discriminated input payload for `updateBlockItem`. */
export type UpdateBlockItemInput<T extends BlockType = BlockType> =
  T extends BlockType ? UpdateBlockItemInputBase<T> : never;

/** Type guard checking whether a raw string matches a supported `BlockType`. */
export function isValidBlockType(value: unknown): value is BlockType {
  return (
    typeof value === 'string' &&
    (VALID_BLOCK_TYPES as readonly string[]).includes(value)
  );
}

function compareBySortOrder(
  a: { sort_order: number; created_at: string },
  b: { sort_order: number; created_at: string },
): number {
  if (a.sort_order !== b.sort_order) {
    return a.sort_order - b.sort_order;
  }
  const timeA = Date.parse(a.created_at);
  const timeB = Date.parse(b.created_at);
  if (!Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB) {
    return timeA - timeB;
  }
  return a.created_at.localeCompare(b.created_at);
}

function attachTypedItems<T extends BlockType>(
  block: ParsedBlockBase<T>,
  rawItems: readonly BlockItemRow[],
): ParsedBlockBase<T> {
  const parsedItems: ParsedBlockItemBase<T>[] = [];
  const sortedItems = rawItems.slice().sort(compareBySortOrder);

  for (const item of sortedItems) {
    if (item.is_deleted) {
      continue;
    }
    try {
      const validatedData = parseBlockItemData(block.type, item.data);
      parsedItems.push({
        id: item.id,
        block_id: item.block_id,
        room_id: item.room_id,
        type: block.type,
        data: validatedData,
        sort_order: item.sort_order,
        is_deleted: item.is_deleted,
        created_by: item.created_by,
        created_at: item.created_at,
        updated_at: item.updated_at,
      });
    } catch (err) {
      console.warn(
        `[PopRoom] Dropping malformed block_item "${item.id}" in block "${block.id}" (${block.type}):`,
        err,
      );
    }
  }

  return {
    ...block,
    items: parsedItems,
  };
}

/** Builds a validated `ParsedBlock` from a raw `BlockRow` and its child `BlockItemRow`s, or `null` on invalid config. */
export function buildParsedBlock(
  block: BlockRow,
  rawItems: readonly BlockItemRow[],
): ParsedBlock | null {
  if (!isValidBlockType(block.type)) {
    console.warn(
      `[PopRoom] Dropping block "${block.id}" with unsupported type "${String(block.type)}"`,
    );
    return null;
  }

  try {
    switch (block.type) {
      case 'poll':
        return attachTypedItems(
          {
            ...block,
            type: 'poll',
            config: parseBlockConfig('poll', block.config),
            items: [],
          },
          rawItems,
        );
      case 'task':
        return attachTypedItems(
          {
            ...block,
            type: 'task',
            config: parseBlockConfig('task', block.config),
            items: [],
          },
          rawItems,
        );
      case 'schedule':
        return attachTypedItems(
          {
            ...block,
            type: 'schedule',
            config: parseBlockConfig('schedule', block.config),
            items: [],
          },
          rawItems,
        );
      case 'expense':
        return attachTypedItems(
          {
            ...block,
            type: 'expense',
            config: parseBlockConfig('expense', block.config),
            items: [],
          },
          rawItems,
        );
    }
  } catch (err) {
    console.warn(
      `[PopRoom] Dropping malformed block "${block.id}" (${block.type}):`,
      err,
    );
    return null;
  }
}

/**
 * Validates raw `blocks` and `block_items` rows through Zod schemas (`src/schemas/blocks.ts`).
 * Malformed blocks or items are logged via `console.warn` and safely omitted rather than crashing the room.
 */
export function parseBlockRowsSafely(
  blocks: readonly BlockRow[],
  items: readonly BlockItemRow[],
): ParsedBlock[] {
  const itemsByBlockId = new Map<string, BlockItemRow[]>();
  for (const item of items) {
    if (item.is_deleted) {
      continue;
    }
    const existing = itemsByBlockId.get(item.block_id);
    if (existing) {
      existing.push(item);
    } else {
      itemsByBlockId.set(item.block_id, [item]);
    }
  }

  const sortedBlocks = blocks.slice().sort(compareBySortOrder);
  const parsedBlocks: ParsedBlock[] = [];

  for (const block of sortedBlocks) {
    const childItems = itemsByBlockId.get(block.id) ?? [];
    const parsed = buildParsedBlock(block, childItems);
    if (parsed) {
      parsedBlocks.push(parsed);
    }
  }

  return parsedBlocks;
}

/** Validates a single raw `BlockItemRow` for a known `BlockType`. */
export function parseSingleBlockItem<T extends BlockType>(
  type: T,
  item: BlockItemRow,
): ParsedBlockItemBase<T> {
  return {
    id: item.id,
    block_id: item.block_id,
    room_id: item.room_id,
    type,
    data: parseBlockItemData(type, item.data),
    sort_order: item.sort_order,
    is_deleted: item.is_deleted,
    created_by: item.created_by,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

/** Validates raw RPC rows returned by `get_room_poll_tallies` or `toggle_poll_vote`, dropping malformed entries safely. */
export function parsePollTalliesSafely(rows: readonly unknown[]): PollTally[] {
  const tallies: PollTally[] = [];
  for (const row of rows) {
    const parsed = PollTallySchema.safeParse(row);
    if (!parsed.success) {
      console.warn('[PopRoom] Dropping malformed poll tally row:', parsed.error);
      continue;
    }
    tallies.push(parsed.data);
  }
  return tallies;
}

/** Trims and validates a block title string. */
export function validateBlockTitle(rawTitle: unknown): string {
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (!title) {
    throw new RoomApiError('INVALID_INPUT', '请输入积木名称');
  }
  if (Array.from(title).length > MAX_BLOCK_TITLE_LENGTH) {
    throw new RoomApiError(
      'INVALID_INPUT',
      `积木名称不能超过 ${MAX_BLOCK_TITLE_LENGTH} 个字`,
    );
  }
  return title;
}

function wrapZodValidationError(err: unknown, fallbackMessage: string): never {
  if (err instanceof RoomApiError) {
    throw err;
  }
  if (err instanceof ZodError) {
    throw new RoomApiError('INVALID_INPUT', fallbackMessage);
  }
  throw new RoomApiError('INVALID_INPUT', fallbackMessage);
}

function assertValidBlockType(
  value: unknown,
  message: string,
): void {
  if (!isValidBlockType(value)) {
    throw new RoomApiError('INVALID_INPUT', message);
  }
}

/** Validates `createBlock` inputs and normalizes `title` and `config` via Zod before persistence. */
export function validateCreateBlockInput<T extends BlockType>(
  input: CreateBlockInputBase<T>,
): {
  roomId: string;
  type: T;
  title: string;
  config: BlockConfigMap[T];
  sortOrder: number | undefined;
  createdBy: string | null | undefined;
} {
  const roomId = input.roomId.trim();
  const blockType: T = input.type;
  if (!roomId) {
    throw new RoomApiError('INVALID_INPUT', '无效的房间或积木类型');
  }
  assertValidBlockType(blockType, '无效的房间或积木类型');

  const title = validateBlockTitle(input.title);

  try {
    const config = parseBlockConfig(blockType, input.config);
    return {
      roomId,
      type: blockType,
      title,
      config,
      sortOrder: input.sortOrder,
      createdBy: input.createdBy,
    };
  } catch (err) {
    wrapZodValidationError(err, '积木配置有误，请检查后重试');
  }
}

/** Validates `updateBlockConfig` inputs via Zod before updating `public.blocks`. */
export function validateUpdateBlockConfigInput<T extends BlockType>(
  input: UpdateBlockConfigInputBase<T>,
): {
  blockId: string;
  type: T;
  config: BlockConfigMap[T];
  title: string | undefined;
} {
  const blockId = input.blockId.trim();
  const blockType: T = input.type;
  if (!blockId) {
    throw new RoomApiError('INVALID_INPUT', '无效的积木标识');
  }
  assertValidBlockType(blockType, '无效的积木标识');

  const title =
    input.title !== undefined ? validateBlockTitle(input.title) : undefined;

  try {
    const config = parseBlockConfig(blockType, input.config);
    return {
      blockId,
      type: blockType,
      config,
      title,
    };
  } catch (err) {
    wrapZodValidationError(err, '积木配置有误，请检查后重试');
  }
}

/** Validates `createBlockItem` payload via Zod before writing to `public.block_items`. */
export function validateCreateBlockItemInput<T extends BlockType>(
  input: CreateBlockItemInputBase<T>,
): {
  blockId: string;
  roomId: string;
  type: T;
  data: BlockItemDataMap[T];
  sortOrder: number | undefined;
  createdBy: string | null | undefined;
} {
  const blockId = input.blockId.trim();
  const roomId = input.roomId.trim();
  const blockType: T = input.type;
  if (!blockId || !roomId) {
    throw new RoomApiError('INVALID_INPUT', '无效的积木或房间标识');
  }
  assertValidBlockType(blockType, '无效的积木或房间标识');

  try {
    const data = parseBlockItemData(blockType, input.data);
    return {
      blockId,
      roomId,
      type: blockType,
      data,
      sortOrder: input.sortOrder,
      createdBy: input.createdBy,
    };
  } catch (err) {
    wrapZodValidationError(err, '条目内容格式有误，请检查必填项');
  }
}

/** Validates `updateBlockItem` payload via Zod before updating `public.block_items`. */
export function validateUpdateBlockItemInput<T extends BlockType>(
  input: UpdateBlockItemInputBase<T>,
): {
  itemId: string;
  type: T;
  data: BlockItemDataMap[T];
  sortOrder: number | undefined;
} {
  const itemId = input.itemId.trim();
  const blockType: T = input.type;
  if (!itemId) {
    throw new RoomApiError('INVALID_INPUT', '无效的条目标识');
  }
  assertValidBlockType(blockType, '无效的条目标识');

  try {
    const data = parseBlockItemData(blockType, input.data);
    return {
      itemId,
      type: blockType,
      data,
      sortOrder: input.sortOrder,
    };
  } catch (err) {
    wrapZodValidationError(err, '条目内容格式有误，请检查必填项');
  }
}

/** Validates task status values against `TaskStatusSchema`. */
export function validateTaskStatusInput(
  status: unknown,
): 'unclaimed' | 'in_progress' | 'done' {
  const parsed = TaskStatusSchema.safeParse(status);
  if (!parsed.success) {
    throw new RoomApiError('INVALID_INPUT', '无效的任务状态');
  }
  return parsed.data;
}

/** Enforces the 3-image task limit and non-empty URL strings before calling `update_task_images`. */
export function validateTaskImagesInput(imageUrls: readonly string[]): string[] {
  if (imageUrls.length > MAX_TASK_IMAGES) {
    throw new RoomApiError(
      'MAX_IMAGES_EXCEEDED',
      mapRoomError('MAX_IMAGES_EXCEEDED'),
    );
  }

  const normalized: string[] = [];
  for (const rawUrl of imageUrls) {
    const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!trimmed) {
      throw new RoomApiError('INVALID_INPUT', '图片地址无效');
    }
    normalized.push(trimmed);
  }
  return normalized;
}

/** Validates and trims an item comment before persisting to `public.item_comments`. */
export function validateCommentContent(rawContent: string): string {
  const trimmed = typeof rawContent === 'string' ? rawContent.trim() : '';
  if (!trimmed) {
    throw new RoomApiError('INVALID_INPUT', '请输入评论内容');
  }
  if (Array.from(trimmed).length > MAX_COMMENT_LENGTH) {
    throw new RoomApiError(
      'INVALID_INPUT',
      `评论内容不能超过 ${MAX_COMMENT_LENGTH} 个字`,
    );
  }
  return trimmed;
}
