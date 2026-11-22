/** Lifecycle status of a PopRoom collaboration room. */
export type RoomStatus = 'active' | 'archived';

/** Gatekeeping mode required when joining a room by code. */
export type JoinMode = 'passcode' | 'approval';

/** Preset scene templates available when creating a room. */
export type TemplateType = 'campus' | 'travel' | 'party' | 'custom';

/** Role of a member inside a room. */
export type MemberRole = 'host' | 'admin' | 'member';

/** Membership status inside a room. */
export type MemberStatus = 'pending' | 'active' | 'rejected' | 'kicked';

/** Supported collaborative block types. */
export type BlockType = 'poll' | 'task' | 'schedule' | 'expense';

/** Recorded actions in `activity_logs`. */
export type ActivityAction =
  | 'delete_item'
  | 'restore_item'
  | 'update_room'
  | 'kick_member'
  | 'delete_message'
  | 'leave_room';

/** Supported message kinds stored in `public.room_messages`. */
export type ChatMessageType = 'text' | 'block_card' | 'system';

/** Row shape for `public.profiles`. */
export interface ProfileRow {
  id: string;
  nickname: string;
  avatar_color: string;
  avatar_url: string | null;
  expo_push_token: string | null;
  created_at: string;
  updated_at: string;
}

/** Public profile fields exposed to room co-members and pending-applicant admins. */
export type ProfileSummary = Pick<
  ProfileRow,
  'id' | 'nickname' | 'avatar_color' | 'avatar_url'
>;

/** Row shape for `public.rooms`. */
export interface RoomRow {
  id: string;
  title: string;
  announcement: string;
  template_type: TemplateType;
  event_start_at: string | null;
  event_end_at: string | null;
  join_mode: JoinMode;
  room_code: string;
  chat_enabled: boolean;
  allow_member_create_poll: boolean;
  status: RoomStatus;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Row shape for `public.room_members`. */
export interface RoomMemberRow {
  id: string;
  room_id: string;
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
  apply_note: string | null;
  joined_at: string;
}

/** Joined `room_members` row including the member's public profile summary. */
export interface RoomMemberWithProfile extends RoomMemberRow {
  profiles: ProfileSummary | null;
}

/**
 * Row shape for `public.blocks`.
 * `config` is typed as `unknown` and must be validated with Zod (`src/schemas/blocks.ts`) before use.
 */
export interface BlockRow {
  id: string;
  room_id: string;
  type: BlockType;
  title: string;
  sort_order: number;
  config: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Row shape for `public.block_items`.
 * `data` is typed as `unknown` and must be validated with Zod (`src/schemas/blocks.ts`) before use.
 */
export interface BlockItemRow {
  id: string;
  block_id: string;
  room_id: string;
  data: unknown;
  sort_order: number;
  is_deleted: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Row shape for `public.poll_votes`. */
export interface PollVoteRow {
  id: string;
  room_id: string;
  block_id: string;
  item_id: string;
  user_id: string;
  created_at: string;
}

/** Row shape for `public.item_comments`. */
export interface ItemCommentRow {
  id: string;
  item_id: string;
  room_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

/** Joined `item_comments` row including the commenter's public profile summary. */
export interface ItemCommentWithProfile extends ItemCommentRow {
  profiles: ProfileSummary | null;
}

/**
 * Row shape for `public.activity_logs`.
 * `before_snapshot` is typed as `unknown` prior to safe inspection/parsing.
 */
export interface ActivityLogRow {
  id: string;
  room_id: string;
  actor_id: string | null;
  action: ActivityAction;
  target_table: string;
  target_id: string;
  before_snapshot: unknown;
  restored_at: string | null;
  created_at: string;
}

/**
 * Aggregated poll tally returned by `get_room_poll_tallies` and `toggle_poll_vote` RPCs.
 * When the parent poll has `anonymous: true`, `voter_ids` is masked to `[]` by the database.
 */
export interface PollTallyRow {
  item_id: string;
  block_id: string;
  vote_count: number;
  my_voted: boolean;
  voter_ids: string[];
}

/** Payload returned by the `join_room_by_code` RPC. */
export interface JoinRoomResult {
  room_id: string;
  status: MemberStatus;
  title: string;
}

/**
 * Row shape for `public.room_messages`.
 * `metadata` is typed as `unknown` and must pass through `ChatMessageMetadataSchema` (`src/schemas/blocks.ts`).
 */
export interface RoomMessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  msg_type: ChatMessageType;
  content: string;
  metadata: unknown;
  is_deleted: boolean;
  created_at: string;
}

/** Joined `room_messages` row including the sender's public profile summary. */
export interface RoomMessageWithSender extends RoomMessageRow {
  profiles: ProfileSummary | null;
}

/** Row shape for `public.message_reports`. */
export interface MessageReportRow {
  id: string;
  message_id: string;
  room_id: string;
  reporter_id: string;
  reason: string;
  created_at: string;
}

/** Row shape for `public.user_blocks`. */
export interface UserBlockRow {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

/** Joined `user_blocks` row including the blocked user's public profile summary. */
export interface BlockedUserWithProfile extends UserBlockRow {
  profiles: ProfileSummary | null;
}

/** Row shape for `public.room_chat_reads`. */
export interface RoomChatReadRow {
  room_id: string;
  user_id: string;
  last_read_at: string;
}
