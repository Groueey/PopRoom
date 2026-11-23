import { supabase } from '../lib/supabase';
import type {
  JoinRoomResult,
  MemberRole,
  ProfileRow,
  ProfileSummary,
  RoomAnnouncementAckRow,
  RoomMemberRow,
  RoomMemberWithProfile,
  RoomRow,
} from '../types/database';
import {
  type CreateRoomInput,
  type LobbyRoomSummary,
  type MyRoomsResult,
  RoomApiError,
  type UpdateRoomMetadataInput,
  mapRoomError,
  prepareJoinPayload,
  toRoomApiError,
  validateCreateRoomInput,
  validateUpdateRoomMetadataInput,
} from './roomHelpers';

export * from './roomHelpers';

const ROOM_COLUMNS =
  'id, title, announcement, announcement_updated_at, template_type, event_start_at, event_end_at, join_mode, room_code, chat_enabled, allow_member_create_poll, status, archived_at, created_by, created_at, updated_at';

const PROFILE_COLUMNS =
  'id, nickname, avatar_color, avatar_url, expo_push_token, created_at, updated_at';

interface MembershipWithRoomJoinRow {
  role: MemberRole;
  joined_at: string;
  rooms: RoomRow | RoomRow[] | null;
}

interface RawMemberWithProfileRow extends RoomMemberRow {
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

/** Fetches active and archived rooms where the given user holds an active membership. */
export async function fetchMyRooms(userId: string): Promise<MyRoomsResult> {
  if (!userId) {
    return { active: [], archived: [] };
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('room_members')
    .select(`role, joined_at, rooms!inner(${ROOM_COLUMNS})`)
    .eq('user_id', userId)
    .eq('status', 'active');

  if (membershipError) {
    throw toRoomApiError(membershipError);
  }

  const rows = (memberships ?? []) as unknown as MembershipWithRoomJoinRow[];
  const summaries: Array<{ room: RoomRow; myRole: MemberRole }> = [];
  const roomIds: string[] = [];

  for (const row of rows) {
    const room = Array.isArray(row.rooms) ? (row.rooms[0] ?? null) : row.rooms;
    if (!room) {
      continue;
    }
    summaries.push({ room, myRole: row.role });
    roomIds.push(room.id);
  }

  if (roomIds.length === 0) {
    return { active: [], archived: [] };
  }

  const { data: activeMembers, error: countError } = await supabase
    .from('room_members')
    .select('room_id')
    .in('room_id', roomIds)
    .eq('status', 'active');

  if (countError) {
    throw toRoomApiError(countError);
  }

  const countsByRoom = new Map<string, number>();
  for (const member of (activeMembers ?? []) as Array<{ room_id: string }>) {
    countsByRoom.set(
      member.room_id,
      (countsByRoom.get(member.room_id) ?? 0) + 1,
    );
  }

  const active: LobbyRoomSummary[] = [];
  const archived: LobbyRoomSummary[] = [];

  for (const entry of summaries) {
    const item: LobbyRoomSummary = {
      room: entry.room,
      myRole: entry.myRole,
      memberCount: countsByRoom.get(entry.room.id) ?? 1,
    };
    if (entry.room.status === 'archived') {
      archived.push(item);
    } else {
      active.push(item);
    }
  }

  active.sort(
    (a, b) => Date.parse(b.room.updated_at) - Date.parse(a.room.updated_at),
  );
  archived.sort(
    (a, b) =>
      Date.parse(b.room.archived_at ?? b.room.updated_at) -
      Date.parse(a.room.archived_at ?? a.room.updated_at),
  );

  return { active, archived };
}

/** Fetches a single room's full details (requires active membership via RLS). */
export async function fetchRoomDetail(roomId: string): Promise<RoomRow> {
  const { data, error } = await supabase
    .from('rooms')
    .select(ROOM_COLUMNS)
    .eq('id', roomId)
    .single();

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('ROOM_NOT_FOUND', mapRoomError('ROOM_NOT_FOUND'));
  }
  return data as RoomRow;
}

/** Fetches all member rows (including pending applicants for admins) with public profile summaries. */
export async function fetchRoomMembers(
  roomId: string,
): Promise<RoomMemberWithProfile[]> {
  const { data, error } = await supabase
    .from('room_members')
    .select(
      'id, room_id, user_id, role, status, apply_note, joined_at, profiles(id, nickname, avatar_color, avatar_url)',
    )
    .eq('room_id', roomId)
    .order('joined_at', { ascending: true });

  if (error) {
    throw toRoomApiError(error);
  }

  const rawRows = (data ?? []) as unknown as RawMemberWithProfileRow[];
  return rawRows.map((row) => ({
    id: row.id,
    room_id: row.room_id,
    user_id: row.user_id,
    role: row.role,
    status: row.status,
    apply_note: row.apply_note,
    joined_at: row.joined_at,
    profiles: normalizeProfileSummary(row.profiles),
  }));
}

/** Fetches the current user's own `room_members` row for a room regardless of status. */
export async function fetchMyRoomMembership(
  roomId: string,
  userId: string,
): Promise<RoomMemberRow | null> {
  const { data, error } = await supabase
    .from('room_members')
    .select('id, room_id, user_id, role, status, apply_note, joined_at')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw toRoomApiError(error);
  }
  return (data as RoomMemberRow | null) ?? null;
}

/** Atomically creates a room, assigns creator as `host`, and seeds template blocks. */
export async function createRoomWithTemplate(
  input: CreateRoomInput,
): Promise<RoomRow> {
  const validated = validateCreateRoomInput(input);
  const { data, error } = await supabase.rpc('create_room_with_template', {
    p_title: validated.title,
    p_template_type: validated.templateType,
    p_join_mode: validated.joinMode,
    p_announcement: validated.announcement,
    p_event_start_at: validated.eventStartAt,
    p_event_end_at: validated.eventEndAt,
    p_chat_enabled: validated.chatEnabled ?? null,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('UNKNOWN_ERROR', mapRoomError('UNKNOWN_ERROR'));
  }
  return data as RoomRow;
}

/** Joins an active room via 6-char room code (direct entry or pending approval). */
export async function joinRoomByCode(
  rawCode: string,
  applyNote?: string,
): Promise<JoinRoomResult> {
  const payload = prepareJoinPayload(rawCode, applyNote);
  const { data, error } = await supabase.rpc('join_room_by_code', payload);

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('ROOM_NOT_FOUND', mapRoomError('ROOM_NOT_FOUND'));
  }
  return data as JoinRoomResult;
}

/** Approves or rejects a pending member application (host/admin only). */
export async function reviewMemberApplication(
  roomId: string,
  targetUserId: string,
  decision: 'approve' | 'reject' | 'active' | 'rejected',
): Promise<RoomMemberRow> {
  const { data, error } = await supabase.rpc('review_member_application', {
    p_room_id: roomId,
    p_target_user_id: targetUserId,
    p_decision: decision,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('UNKNOWN_ERROR', mapRoomError('UNKNOWN_ERROR'));
  }
  return data as RoomMemberRow;
}

/** Promotes or demotes an active room member between `admin` and `member` (host only). */
export async function updateMemberRole(
  roomId: string,
  targetUserId: string,
  role: 'admin' | 'member',
): Promise<RoomMemberRow> {
  const { data, error } = await supabase.rpc('update_member_role', {
    p_room_id: roomId,
    p_target_user_id: targetUserId,
    p_role: role,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('UNKNOWN_ERROR', mapRoomError('UNKNOWN_ERROR'));
  }
  return data as RoomMemberRow;
}

/** Kicks a member from an active room and records an audit log entry. */
export async function kickRoomMember(
  roomId: string,
  targetUserId: string,
): Promise<void> {
  const { error } = await supabase.rpc('kick_room_member', {
    p_room_id: roomId,
    p_target_user_id: targetUserId,
  });

  if (error) {
    throw toRoomApiError(error);
  }
}

/** Generates a new globally unique 6-char room code, invalidating the old one. */
export async function resetRoomCode(roomId: string): Promise<string> {
  const { data, error } = await supabase.rpc('reset_room_code', {
    p_room_id: roomId,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (typeof data !== 'string' || !data) {
    throw new RoomApiError(
      'ROOM_CODE_GENERATION_FAILED',
      mapRoomError('ROOM_CODE_GENERATION_FAILED'),
    );
  }
  return data;
}

/** Updates editable room metadata (title, announcement, join_mode, poll/chat policy, event window) for active admins. */
export async function updateRoomMetadata(
  roomId: string,
  input: UpdateRoomMetadataInput,
): Promise<RoomRow> {
  const validated = validateUpdateRoomMetadataInput(input);
  const payload: UpdateRoomMetadataInput = {};

  if (validated.title !== undefined) {
    payload.title = validated.title;
  }
  if (validated.announcement !== undefined) {
    payload.announcement = validated.announcement;
  }
  if (validated.join_mode !== undefined) {
    payload.join_mode = validated.join_mode;
  }
  if (validated.allow_member_create_poll !== undefined) {
    payload.allow_member_create_poll = validated.allow_member_create_poll;
  }
  if (validated.chat_enabled !== undefined) {
    payload.chat_enabled = validated.chat_enabled;
  }
  if (validated.event_start_at !== undefined) {
    payload.event_start_at = validated.event_start_at;
  }
  if (validated.event_end_at !== undefined) {
    payload.event_end_at = validated.event_end_at;
  }

  const { data, error } = await supabase
    .from('rooms')
    .update(payload)
    .eq('id', roomId)
    .select(ROOM_COLUMNS)
    .single();

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('ROOM_NOT_FOUND', mapRoomError('ROOM_NOT_FOUND'));
  }
  return data as RoomRow;
}

/** Leaves an active room as a non-host member via `leave_room` RPC. */
export async function leaveRoom(roomId: string): Promise<void> {
  const trimmedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
  if (!trimmedRoomId) {
    throw new RoomApiError('INVALID_INPUT', '房间参数无效');
  }

  const { error } = await supabase.rpc('leave_room', {
    p_room_id: trimmedRoomId,
  });

  if (error) {
    throw toRoomApiError(error);
  }
}

/** Archives an active room so all members become permanently read-only (host only). */
export async function archiveRoom(roomId: string): Promise<RoomRow> {
  const { data, error } = await supabase.rpc('archive_room', {
    p_room_id: roomId,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('ROOM_NOT_FOUND', mapRoomError('ROOM_NOT_FOUND'));
  }
  return data as RoomRow;
}

/** Fetches all announcement acknowledgement rows for a room (active members only via RLS). */
export async function fetchRoomAnnouncementAcks(
  roomId: string,
): Promise<RoomAnnouncementAckRow[]> {
  if (!roomId) {
    return [];
  }

  const { data, error } = await supabase
    .from('room_announcement_acks')
    .select('room_id, user_id, announcement_version, acked_at')
    .eq('room_id', roomId)
    .order('acked_at', { ascending: true });

  if (error) {
    throw toRoomApiError(error);
  }
  return (data ?? []) as RoomAnnouncementAckRow[];
}

/** Confirms that the signed-in member has read the latest room announcement via atomic RPC. */
export async function acknowledgeRoomAnnouncement(
  roomId: string,
): Promise<RoomAnnouncementAckRow> {
  const trimmedRoomId = typeof roomId === 'string' ? roomId.trim() : '';
  if (!trimmedRoomId) {
    throw new RoomApiError('INVALID_INPUT', '房间参数无效');
  }

  const { data, error } = await supabase.rpc('acknowledge_room_announcement', {
    p_room_id: trimmedRoomId,
  });

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('UNKNOWN_ERROR', mapRoomError('UNKNOWN_ERROR'));
  }
  return data as RoomAnnouncementAckRow;
}

/** Updates the signed-in user's nickname and avatar color swatch. */
export async function updateMyProfile(
  userId: string,
  input: { nickname: string; avatar_color: string },
): Promise<ProfileRow> {
  const trimmedNickname = input.nickname.trim();
  const len = Array.from(trimmedNickname).length;
  if (len < 1 || len > 20) {
    throw new RoomApiError('INVALID_INPUT', '请输入 1–20 个字符的昵称');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({
      nickname: trimmedNickname,
      avatar_color: input.avatar_color,
    })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    throw toRoomApiError(error);
  }
  if (!data) {
    throw new RoomApiError('PROFILE_REQUIRED', mapRoomError('PROFILE_REQUIRED'));
  }
  return data as ProfileRow;
}
