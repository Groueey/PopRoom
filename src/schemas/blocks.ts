import { z } from 'zod';
import type { BlockType } from '../types/database';

/** Supported voting modes for a poll block. */
export const PollModeSchema = z.enum(['option', 'availability']);

/** Supported time-of-day periods for availability heatmaps. */
export const PollTimeSlotSchema = z.enum(['morning', 'afternoon', 'evening']);
export type PollTimeSlot = z.infer<typeof PollTimeSlotSchema>;

/** Configuration schema stored in `blocks.config` for `type = 'poll'`. */
export const PollConfigSchema = z.object({
  mode: PollModeSchema,
  multiple: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  allowAddOption: z.boolean().default(true),
  deadline: z.string().min(1).nullable().default(null),
  isLocked: z.boolean().default(false),
  candidateDates: z.array(z.string().min(1)).optional(),
  timeSlots: z.array(PollTimeSlotSchema).optional(),
});
export type PollConfig = z.infer<typeof PollConfigSchema>;

/**
 * Item payload schema stored in `block_items.data` for `type = 'poll'`.
 * Deliberately excludes `voterIds` so vote attribution is served solely by `get_room_poll_tallies`.
 */
export const PollItemDataSchema = z.object({
  label: z.string().min(1),
  slotDate: z.string().min(1).optional(),
  slotPeriod: PollTimeSlotSchema.optional(),
});
export type PollItemData = z.infer<typeof PollItemDataSchema>;

/** Schema for aggregated poll tallies returned by `get_room_poll_tallies` and `toggle_poll_vote`. */
export const PollTallySchema = z.object({
  item_id: z.string().min(1),
  block_id: z.string().min(1),
  vote_count: z.number().int().min(0),
  my_voted: z.boolean(),
  voter_ids: z.array(z.string().min(1)),
});
export type PollTally = z.infer<typeof PollTallySchema>;

/** Lifecycle states for a collaborative task item. */
export const TaskStatusSchema = z.enum(['unclaimed', 'in_progress', 'done']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** Configuration schema stored in `blocks.config` for `type = 'task'`. */
export const TaskConfigSchema = z.object({
  allowMemberCreate: z.boolean().default(true),
});
export type TaskConfig = z.infer<typeof TaskConfigSchema>;

/** Item payload schema stored in `block_items.data` for `type = 'task'`. */
export const TaskItemDataSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  status: TaskStatusSchema.default('unclaimed'),
  assigneeIds: z.array(z.string().min(1)).default([]),
  dueAt: z.string().min(1).nullable().default(null),
  imageUrls: z.array(z.string().min(1)).max(3).default([]),
});
export type TaskItemData = z.infer<typeof TaskItemDataSchema>;

/** Grouping mode for schedule timeline items. */
export const ScheduleGroupBySchema = z.enum(['day', 'phase']);

/** Configuration schema stored in `blocks.config` for `type = 'schedule'`. */
export const ScheduleConfigSchema = z.object({
  groupBy: ScheduleGroupBySchema.default('day'),
});
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

/** Item payload schema stored in `block_items.data` for `type = 'schedule'`. */
export const ScheduleItemDataSchema = z.object({
  groupLabel: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1).optional(),
  title: z.string().min(1),
  locationName: z.string().min(1).optional(),
  latitude: z.number().finite().optional(),
  longitude: z.number().finite().optional(),
  ownerId: z.string().min(1).nullable().default(null),
  notes: z.string().default(''),
});
export type ScheduleItemData = z.infer<typeof ScheduleItemDataSchema>;

/** Supported expense modes: budget tracking or AA group split. */
export const ExpenseModeSchema = z.enum(['budget', 'split']);

/** Configuration schema stored in `blocks.config` for `type = 'expense'`. */
export const ExpenseConfigSchema = z.object({
  mode: ExpenseModeSchema,
  totalBudget: z.number().nonnegative().nullable().default(null),
  currency: z.literal('CNY').default('CNY'),
});
export type ExpenseConfig = z.infer<typeof ExpenseConfigSchema>;

/** Item payload schema stored in `block_items.data` for `type = 'expense'`. */
export const ExpenseItemDataSchema = z.object({
  title: z.string().min(1),
  amount: z.number().finite().positive(),
  paidByUserId: z.string().min(1),
  participantIds: z.array(z.string().min(1)).min(1),
  receiptUrl: z.string().min(1).nullable().default(null),
  spentAt: z.string().min(1),
});
export type ExpenseItemData = z.infer<typeof ExpenseItemDataSchema>;

/** Mapping from `BlockType` to its validated config shape. */
export interface BlockConfigMap {
  poll: PollConfig;
  task: TaskConfig;
  schedule: ScheduleConfig;
  expense: ExpenseConfig;
}

/** Mapping from `BlockType` to its validated item payload shape. */
export interface BlockItemDataMap {
  poll: PollItemData;
  task: TaskItemData;
  schedule: ScheduleItemData;
  expense: ExpenseItemData;
}

/** Parses and validates a raw `blocks.config` JSONB payload according to its `BlockType`. */
export function parseBlockConfig<T extends BlockType>(
  type: T,
  raw: unknown,
): BlockConfigMap[T];
export function parseBlockConfig(
  type: BlockType,
  raw: unknown,
): BlockConfigMap[BlockType] {
  switch (type) {
    case 'poll':
      return PollConfigSchema.parse(raw);
    case 'task':
      return TaskConfigSchema.parse(raw);
    case 'schedule':
      return ScheduleConfigSchema.parse(raw);
    case 'expense':
      return ExpenseConfigSchema.parse(raw);
  }
}

/** Parses and validates a raw `block_items.data` JSONB payload according to its `BlockType`. */
export function parseBlockItemData<T extends BlockType>(
  type: T,
  raw: unknown,
): BlockItemDataMap[T];
export function parseBlockItemData(
  type: BlockType,
  raw: unknown,
): BlockItemDataMap[BlockType] {
  switch (type) {
    case 'poll':
      return PollItemDataSchema.parse(raw);
    case 'task':
      return TaskItemDataSchema.parse(raw);
    case 'schedule':
      return ScheduleItemDataSchema.parse(raw);
    case 'expense':
      return ExpenseItemDataSchema.parse(raw);
  }
}

/** Payload metadata schema stored in `room_messages.metadata`. */
export const ChatMessageMetadataSchema = z.object({
  mentionAll: z.boolean().default(false),
  mentionUserIds: z.array(z.string().min(1)).default([]),
  linkedBlockId: z.string().min(1).optional(),
  linkedItemId: z.string().min(1).optional(),
  linkedBlockType: z.enum(['poll', 'task', 'schedule', 'expense']).optional(),
  linkedTitle: z.string().min(1).optional(),
});
export type ChatMessageMetadata = z.infer<typeof ChatMessageMetadataSchema>;

/** Safely parses a raw `room_messages.metadata` payload or returns defaults for null/undefined/non-object inputs. */
export function parseChatMessageMetadata(raw: unknown): ChatMessageMetadata {
  return ChatMessageMetadataSchema.parse(
    raw && typeof raw === 'object' ? raw : {},
  );
}
