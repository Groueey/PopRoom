# 轻橘 PopRoom 第二阶段（方案 A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Stage 2 (Approach A) of **轻橘 PopRoom** inside Expo Go: host-controlled room chat (`协作看板 | 聊天室`), bidirectional chat ↔ block linkage (message-to-task/schedule conversion & block reminder cards), UGC compliance (delete/report/block with unblock management), 7-day `pg_cron` auto-archival, and high-frequency Stage 1 polish (block reordering, non-host leave room, editable event window, native share invite).

**Architecture:** Additive Supabase migrations (`004` & `005`, leaving Stage 1 `001`–`003` intact) enforce the same `SECURITY DEFINER` RPC write boundary (`SET search_path = public`), strict RLS (`room_messages` hides soft-deleted rows and blocked senders at the DB layer), and archive immutability lock. On the Expo Router client, pure testable helper modules (`chatHelpers.ts`, `blockOrderHelpers.ts`, `shareInvite.ts`) pair with TanStack Query + room-scoped Realtime (`room_messages`) and the guarded `SheetModal` bottom-sheet wrapper so every new flow works smoothly single-handed in Expo Go.

**Tech Stack:** Expo SDK 58 (Expo Go compatible), React Native 0.88, React 19.3, Expo Router, TypeScript (Strict Mode), NativeWind v4, `lucide-react-native`, `@gorhom/bottom-sheet` (via guarded `SheetModal`), TanStack Query v5 + AsyncStorage persister, Zustand, Supabase (PostgreSQL, Auth, Realtime, `pg_cron`), Zod, `expo-linking`, `expo-clipboard`, React Native `Share`, Vitest.

**Spec:** [docs/superpowers/specs/2026-11-22-poproom-stage2-design.md](../specs/2026-11-22-poproom-stage2-design.md)

## Global Constraints

- **Expo Go Compatibility:** Every Stage 2 dependency and feature MUST run inside Expo Go (SDK 58); do NOT add native-only modules requiring custom Dev Builds (no `expo-notifications`, no Apple/WeChat native login).
- **Backward-Compatible Migrations:** Do NOT modify `001_initial_schema.sql`, `002_rls_policies.sql`, or `003_rpcs.sql`; place all Stage 2 schema, RLS, RPC, and `pg_cron` changes in `004_stage2_chat_and_compliance.sql` and `005_stage2_rpcs_and_auto_archive.sql` so Stage 1 Supabase instances upgrade cleanly and existing `tests/supabase/migrations.test.ts` remains green.
- **Strict Type Safety:** Zero `any` in `src/` or `app/`; all `room_messages.metadata` payloads MUST pass through `ChatMessageMetadataSchema` in `src/schemas/blocks.ts`.
- **Single-Handed Mobile UX & Theme:** All menus, pickers, report forms, and confirmations MUST use `SheetModal` (`src/components/ui/SheetModal.tsx`) with the warm tangerine palette (`#F97316` primary, `#FFF7ED` soft tint, `#F8FAFC` surface, `#18181B` ink).
- **Collaboration-First Default:** Entering a room MUST always default to the `协作看板` tab; when `rooms.chat_enabled === false`, no chat tab or reminder buttons may render.
- **Archive Immutability:** When `rooms.status = 'archived'`, sending/deleting chat messages, reordering blocks, editing room settings, and leaving the room MUST be rejected at both RPC/RLS and UI layers (only viewing, exporting recap, and UGC reporting/blocking remain permitted).
- **Anonymous Poll Privacy Preserved:** `poll_votes` MUST remain excluded from `supabase_realtime` when adding `room_messages` to the publication.
- **Windows Shell Command Note:** On this workspace, invoke `npm.cmd` and `npx.cmd` in PowerShell.

## Review Focus

1. **Blocked-user Realtime leakage & instant hide/unblock:** Blocking a user in chat must immediately strip their existing messages from view, prevent subsequent Realtime messages from that user from appearing or incrementing unread counts, and remain reversible via `profile.tsx` *(pinned in Task 1, Task 3, Task 5 & Task 7)*.
2. **Mid-session `chat_enabled` disable or room archival while chatting:** If the host turns off `chat_enabled` or archives the room while a member sends a message, `send_room_message` must reject with `CHAT_DISABLED` / `ROOM_ARCHIVED`, optimistic UI must roll back cleanly, and disabling chat must return the user to `协作看板` *(pinned in Task 1, Task 2, Task 5 & Task 6)*.
3. **"Chat → Block" conversion when the room lacks a Task or Schedule block (`party`/`custom` templates):** Choosing `转为分工任务` or `加入日程轴` when no matching block exists must auto-create the block for host/admin before opening the prefilled drawer, and show a clear actionable toast for regular members rather than silently failing *(pinned in Task 6)*.
4. **Non-host `leave_room` vs host protection & archived roster preservation:** Regular members/admins can leave an active room (and rejoin later via code), while the host is rejected with `HOST_CANNOT_LEAVE`, and leaving an archived room is rejected with `ROOM_ARCHIVED` so historical recap & AA settlement profiles stay intact *(pinned in Task 1, Task 2 & Task 4)*.
5. **Unread badge accuracy across self-messages, deleted rows, and blocked senders:** Messages authored by `currentUserId`, soft-deleted messages, or messages from blocked users must never increment the unread badge, and opening the Chat tab must advance `room_chat_reads.last_read_at` to clear the count to `0` *(pinned in Task 3 & Task 6)*.

---

## File Structure Map

```text
PopRoom/
├── supabase/
│   ├── README.md & README.zh.md                            # Updated with 004/005 + pg_cron guide
│   └── migrations/
│       ├── 004_stage2_chat_and_compliance.sql              # room_messages, message_reports, user_blocks, room_chat_reads, RLS, Realtime
│       └── 005_stage2_rpcs_and_auto_archive.sql            # 6 new/updated SECURITY DEFINER RPCs + conditional pg_cron daily job
├── src/
│   ├── types/database.ts                                   # + ChatMessageType, RoomMessageRow/WithSender, MessageReportRow, UserBlockRow, RoomChatReadRow
│   ├── schemas/blocks.ts                                   # + ChatMessageMetadataSchema & parseChatMessageMetadata
│   ├── lib/
│   │   ├── queryClient.ts                                  # + roomMessages, roomChatRead, userBlocks keys
│   │   ├── templates.ts                                    # Restore template chatEnabled defaults (campus/travel=true, party/custom=false)
│   │   ├── chatHelpers.ts                                  # Pure parsing, unread counter, block filter, optimistic helpers, reminder & prefill builders
│   │   ├── blockOrderHelpers.ts                            # Pure up/down reorder & list projection helpers
│   │   ├── shareInvite.ts                                  # Native Share.share invite helper with clipboard fallback
│   │   └── activityLogHelpers.ts                           # + labels for delete_message & leave_room
│   ├── api/
│   │   ├── roomHelpers.ts                                  # + Stage 2 error codes, chatEnabled on create, event window & chat_enabled on update
│   │   ├── rooms.ts                                        # + p_chat_enabled, event window update, leaveRoom RPC
│   │   ├── blocks.ts                                       # + reorderRoomBlocks RPC
│   │   └── chat.ts                                         # Messages, send/delete/report RPCs, user_blocks & room_chat_reads queries
│   ├── hooks/
│   │   ├── useRoomPermissions.ts                           # + chat/mention/reminder/report/block/reorder/leave capabilities
│   │   ├── realtimeHelpers.ts                              # + room_messages invalidation mapping
│   │   └── useRoomRealtime.ts                              # + room_messages subscription on room:${roomId}
│   └── components/
│       ├── chat/
│       │   ├── BlockReminderCard.tsx                       # Interactive reminder card jumping to & highlighting target block
│       │   └── ChatRoomView.tsx                            # Realtime chat feed, @mentions, long-press actions, report/block modals
│       └── blocks/
│           ├── PollBlock.tsx                               # + reminder button, reorder controls, highlight ring
│           ├── TaskBlock.tsx                               # + reminder button, reorder controls, highlight ring, externalCreateDraft prefill
│           ├── ScheduleBlock.tsx                           # + reorder controls, highlight ring, externalCreateDraft prefill
│           └── ExpenseBlock.tsx                            # + reorder controls, highlight ring
├── app/
│   ├── (tabs)/profile.tsx                                  # + Blocked users list & one-tap unblock
│   └── room/
│       ├── create.tsx                                      # + chat_enabled toggle synced with template defaults
│       └── [id]/
│           ├── index.tsx                                   # + Dual tab (Board|Chat), unread badge, bidirectional linkage, reorder mode, native share
│           ├── settings.tsx                                # + chat_enabled switch, event window edit, native share, non-host leave room
│           └── logs.tsx                                    # + delete_message & leave_room timeline rendering
├── docs/superpowers/verification/
│   └── stage2-device-checklist.md                          # Dual-phone Expo Go Stage 2 acceptance checklist
└── tests/
    ├── supabase/stage2Migrations.test.ts                   # SQL contract tests for 004 & 005
    ├── lib/chatHelpers.test.ts                             # Unread, filter, optimistic, reminder & prefill tests
    ├── lib/blockOrderHelpers.test.ts                       # Reorder & shareInvite tests
    └── api/chat.test.ts                                    # Chat validation, error mapping & permission extension tests
```

---

## Milestone 1: Stage 2 Database Foundation, Types, Permissions & Pure Logic

### Task 1: Stage 2 SQL Migrations (`004` & `005`) & Supabase Setup Docs

**Files:**
- Create: `supabase/migrations/004_stage2_chat_and_compliance.sql`
- Create: `supabase/migrations/005_stage2_rpcs_and_auto_archive.sql`
- Modify: `supabase/README.md`, `supabase/README.zh.md`
- Test: `tests/supabase/stage2Migrations.test.ts`

**Interfaces:**
- Consumes: Stage 1 tables & helpers from `001`–`003` (`is_active_member`, `is_room_admin`, `is_room_host`, `is_room_active`, `generate_unique_room_code`).
- Produces:
  - Tables: `public.room_messages`, `public.message_reports`, `public.user_blocks`, `public.room_chat_reads`.
  - Realtime: `room_messages` added to `supabase_realtime` (with `REPLICA IDENTITY FULL`); `poll_votes` stays excluded.
  - RPCs (`SECURITY DEFINER`, `SET search_path = public`):
    - `create_room_with_template(p_title, p_template_type, p_join_mode, p_announcement DEFAULT '', p_event_start_at DEFAULT NULL, p_event_end_at DEFAULT NULL, p_chat_enabled BOOLEAN DEFAULT NULL) RETURNS public.rooms`
    - `send_room_message(p_room_id UUID, p_msg_type TEXT, p_content TEXT, p_metadata JSONB DEFAULT '{}'::jsonb) RETURNS public.room_messages`
    - `soft_delete_room_message(p_message_id UUID) RETURNS public.room_messages`
    - `report_room_message(p_message_id UUID, p_reason TEXT) RETURNS public.message_reports`
    - `reorder_room_blocks(p_room_id UUID, p_block_ids UUID[]) RETURNS VOID`
    - `leave_room(p_room_id UUID) RETURNS VOID`
    - `auto_archive_expired_rooms() RETURNS INT`

- [ ] **Step 1: Write failing migration contract test `tests/supabase/stage2Migrations.test.ts`**

Create `tests/supabase/stage2Migrations.test.ts` verifying:
- `004_stage2_chat_and_compliance.sql` defines `room_messages`, `message_reports`, `user_blocks`, `room_chat_reads`, enables RLS on all 4, filters `is_deleted = FALSE` and `user_blocks` in `room_messages` SELECT policy *(Review Focus #1)*, blocks direct client `INSERT/UPDATE/DELETE` on `room_messages`, extends `activity_logs` action constraint with `'delete_message'` and `'leave_room'`, and adds `room_messages` (never `poll_votes`) to `supabase_realtime`.
- `005_stage2_rpcs_and_auto_archive.sql` defines all 7 functions with `SECURITY DEFINER` and `SET search_path = public`, enforces:
  - `send_room_message`: `ROOM_ARCHIVED`, `CHAT_DISABLED`, `FORBIDDEN` for non-admin `block_card` or `mentionAll` *(Review Focus #2)*.
  - `soft_delete_room_message`: `ROOM_ARCHIVED`, `FORBIDDEN`, writes `activity_logs` with `'delete_message'`.
  - `report_room_message`: `is_active_member`, rejects self-report, allows archived rooms.
  - `reorder_room_blocks`: `is_room_admin`, `ROOM_ARCHIVED`, exact block set check.
  - `leave_room`: rejects host (`HOST_CANNOT_LEAVE`) and archived rooms (`ROOM_ARCHIVED`) *(Review Focus #4)*.
  - `auto_archive_expired_rooms`: archives active rooms where `event_end_at <= NOW() - INTERVAL '7 days'`, plus guarded `pg_cron` schedule `poproom-auto-archive-daily`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/supabase/stage2Migrations.test.ts`
Expected: FAIL (missing `004` and `005` migration files).

- [ ] **Step 3: Implement `supabase/migrations/004_stage2_chat_and_compliance.sql` and `supabase/migrations/005_stage2_rpcs_and_auto_archive.sql`**

Write both idempotent SQL migration files matching the exact style and security hardening (`REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated, service_role;`) of `001`–`003`. For `activity_logs` action constraint update in `004`, use a `DO $$` block dropping any existing CHECK constraint referencing `action` on `public.activity_logs` before adding `activity_logs_action_check`. For `pg_cron` in `005`, guard `cron.unschedule` / `cron.schedule` behind `EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')`.

- [ ] **Step 4: Update `supabase/README.md` and `supabase/README.zh.md`**

Document running `004_stage2_chat_and_compliance.sql` and `005_stage2_rpcs_and_auto_archive.sql` after `001`–`003`, and explain enabling the `pg_cron` extension in Supabase Dashboard (`Database → Extensions → pg_cron`) before running `005` for automatic 7-day archival.

- [ ] **Step 5: Run migration tests and verify existing Stage 1 migration tests remain green**

Run: `npx.cmd vitest run tests/supabase/migrations.test.ts tests/supabase/stage2Migrations.test.ts`
Expected: PASS (all tests in both files green).

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/004_stage2_chat_and_compliance.sql supabase/migrations/005_stage2_rpcs_and_auto_archive.sql supabase/README.md supabase/README.zh.md tests/supabase/stage2Migrations.test.ts
git commit -m "feat(supabase): add Stage 2 chat, compliance, reorder/leave RPCs, and 7-day auto-archive migrations"
```

---

### Task 2: Stage 2 Types, Zod Metadata Contract, Error Codes, Template Defaults & Permissions

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/schemas/blocks.ts`
- Modify: `src/api/roomHelpers.ts`
- Modify: `src/lib/templates.ts`
- Modify: `src/hooks/useRoomPermissions.ts`
- Test: `tests/hooks/useRoomPermissions.test.ts`, `tests/lib/schemasAndRoomCode.test.ts`, `tests/api/rooms.test.ts`

**Interfaces:**
- Consumes: Existing types and schemas from Stage 1.
- Produces:
  - `src/types/database.ts`: `ChatMessageType`, `RoomMessageRow`, `RoomMessageWithSender`, `MessageReportRow`, `UserBlockRow`, `RoomChatReadRow`; `ActivityAction` includes `'delete_message' | 'leave_room'`.
  - `src/schemas/blocks.ts`: `ChatMessageMetadataSchema`, `ChatMessageMetadata`, `parseChatMessageMetadata(raw: unknown): ChatMessageMetadata`.
  - `src/api/roomHelpers.ts`: `RoomErrorCode` includes `'CHAT_DISABLED' | 'HOST_CANNOT_LEAVE' | 'CANNOT_BLOCK_SELF'`; `CreateRoomInput.chatEnabled?: boolean`; `UpdateRoomMetadataInput` accepts `chat_enabled?: boolean`, `event_start_at?: string | null`, `event_end_at?: string | null`.
  - `src/lib/templates.ts`: `ROOM_TEMPLATES.campus.chatEnabled === true`, `ROOM_TEMPLATES.travel.chatEnabled === true`, `ROOM_TEMPLATES.party.chatEnabled === false`, `ROOM_TEMPLATES.custom.chatEnabled === false`.
  - `src/hooks/useRoomPermissions.ts`: `RoomPermissionsInput.chatEnabled?: boolean` (defaults `false`); `RoomPermissions` adds `canSendChatMessage`, `canMentionAll`, `canSendBlockReminder`, `canDeleteChatMessage(senderId)`, `canReportChatMessage(senderId)`, `canBlockUser(targetUserId)`, `canReorderBlocks`, `canLeaveRoom`.

- [ ] **Step 1: Add failing tests for Stage 2 schemas, room validation, template defaults, and permissions**

Extend:
- `tests/lib/schemasAndRoomCode.test.ts`: test `ChatMessageMetadataSchema` defaults (`mentionAll: false`, `mentionUserIds: []`), valid `block_card` metadata (`linkedBlockId`, `linkedBlockType`, `linkedTitle`), and rejection of invalid `linkedBlockType`.
- `tests/api/rooms.test.ts`: test `mapRoomError('CHAT_DISABLED')`, `mapRoomError('HOST_CANNOT_LEAVE')`, `mapRoomError('CANNOT_BLOCK_SELF')`, `validateUpdateRoomMetadataInput` rejecting `event_end_at < event_start_at` and accepting `chat_enabled`, and `ROOM_TEMPLATES` Stage 2 `chatEnabled` defaults.
- `tests/hooks/useRoomPermissions.test.ts`: test Stage 2 flags across `host`, `admin`, `member`, `chatEnabled: false` *(Review Focus #2)*, and `roomStatus: 'archived'` *(Review Focus #4)* — specifically:
  - `member` with `chatEnabled: true` & active: `canSendChatMessage: true`, `canMentionAll: false`, `canSendBlockReminder: false`, `canLeaveRoom: true`, `canDeleteChatMessage(ownId): true`, `canDeleteChatMessage(otherId): false`.
  - `host`: `canLeaveRoom: false`, `canReorderBlocks: true`, `canMentionAll: true`, `canSendBlockReminder: true`.
  - `archived`: `canSendChatMessage: false`, `canDeleteChatMessage(ownId): false`, `canReorderBlocks: false`, `canLeaveRoom: false`, while `canReportChatMessage(otherId): true` and `canBlockUser(otherId): true`.

- [ ] **Step 2: Run targeted tests to verify new assertions fail**

Run: `npx.cmd vitest run tests/hooks/useRoomPermissions.test.ts tests/lib/schemasAndRoomCode.test.ts tests/api/rooms.test.ts`
Expected: FAIL on newly added Stage 2 assertions.

- [ ] **Step 3: Implement updates in `database.ts`, `blocks.ts`, `roomHelpers.ts`, `templates.ts`, and `useRoomPermissions.ts`**

Apply exact type, schema, validation, template default, and permission updates with zero `any` and full backward compatibility for existing callers.

- [ ] **Step 4: Run full test suite & typecheck**

Run: `npx.cmd vitest run` and `npx.cmd tsc --noEmit`
Expected: All test suites PASS and 0 TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add src/types/database.ts src/schemas/blocks.ts src/api/roomHelpers.ts src/lib/templates.ts src/hooks/useRoomPermissions.ts tests/hooks/useRoomPermissions.test.ts tests/lib/schemasAndRoomCode.test.ts tests/api/rooms.test.ts
git commit -m "feat(contracts): add Stage 2 chat schemas, error codes, template defaults, and permissions"
```

---

### Task 3: Chat Helpers, Chat API Layer & Realtime Wiring

**Files:**
- Create: `src/lib/chatHelpers.ts`
- Create: `src/api/chat.ts`
- Modify: `src/lib/queryClient.ts`
- Modify: `src/hooks/realtimeHelpers.ts`
- Modify: `src/hooks/useRoomRealtime.ts`
- Test: `tests/lib/chatHelpers.test.ts`, `tests/api/chat.test.ts`

**Interfaces:**
- Consumes: `RoomMessageRow`, `RoomMessageWithSender`, `ChatMessageMetadata`, `parseChatMessageMetadata`, `ParsedBlock`, `PollTally`, `QUERY_KEYS`, `RoomApiError`, `toRoomApiError`.
- Produces:
  - `src/lib/queryClient.ts`: `QUERY_KEYS.roomMessages(roomId)`, `QUERY_KEYS.roomChatRead(roomId, userId)`, `QUERY_KEYS.userBlocks(userId)`.
  - `src/lib/chatHelpers.ts`:
    - `ParsedRoomMessage` (with parsed `metadata: ChatMessageMetadata`)
    - `MAX_CHAT_MESSAGE_LENGTH = 1000`, `MAX_REPORT_REASON_LENGTH = 300`, `REPORT_REASON_PRESETS`
    - `parseChatMessagesSafely(rows: readonly RoomMessageWithSender[]): ParsedRoomMessage[]`
    - `filterVisibleChatMessages(messages: readonly ParsedRoomMessage[], blockedUserIds: ReadonlySet<string>): ParsedRoomMessage[]`
    - `countUnreadChatMessages(messages: readonly ParsedRoomMessage[], lastReadAt: string | null, currentUserId: string | null, blockedUserIds: ReadonlySet<string>): number`
    - `appendOptimisticChatMessage(existing: readonly ParsedRoomMessage[], draft: OptimisticChatDraft): ParsedRoomMessage[]`
    - `buildBlockReminderMessage(block: ParsedBlock<'poll' | 'task'>, tallies?: readonly PollTally[]): { content: string; metadata: ChatMessageMetadata }`
    - `buildBlockPrefillFromMessage(content: string, target: 'task' | 'schedule'): { title: string; notesOrDescription: string }`
    - `isCurrentUserMentioned(metadata: ChatMessageMetadata, currentUserId: string | null): boolean`
    - `formatChatTimestamp(iso: string): string`
  - `src/api/chat.ts`:
    - `fetchRoomMessages(roomId: string): Promise<ParsedRoomMessage[]>`
    - `sendRoomMessage(input: SendRoomMessageInput): Promise<ParsedRoomMessage>`
    - `softDeleteRoomMessage(messageId: string): Promise<void>`
    - `reportRoomMessage(messageId: string, reason: string): Promise<void>`
    - `fetchMyBlockedUsers(userId: string): Promise<BlockedUserWithProfile[]>`
    - `blockUser(blockedId: string): Promise<void>`
    - `unblockUser(blockedId: string): Promise<void>`
    - `fetchRoomChatRead(roomId: string, userId: string): Promise<string | null>`
    - `markRoomChatRead(roomId: string, userId: string): Promise<string>`
  - `src/hooks/realtimeHelpers.ts` & `useRoomRealtime.ts`: listens to `room_messages` (`filter: room_id=eq.${roomId}`) and invalidates `QUERY_KEYS.roomMessages(roomId)`.

- [ ] **Step 1: Write failing tests in `tests/lib/chatHelpers.test.ts` and `tests/api/chat.test.ts`**

Cover:
- `filterVisibleChatMessages` removes soft-deleted rows and any message whose `sender_id` is in `blockedUserIds` *(Review Focus #1)*.
- `countUnreadChatMessages` excludes `currentUserId` messages, deleted messages, and blocked senders; returns `0` when `lastReadAt >= latestMessage.created_at`; counts strictly newer messages when `lastReadAt` is older or `null` *(Review Focus #5)*.
- `buildBlockReminderMessage` produces accurate Chinese summary copy for poll (`当前已有 X 票，快来参与投票`) and task (`还有 X 项待认领，快来认领分工` / `共 X 项任务，已完成 Y 项`) with `linkedBlockId`, `linkedBlockType`, `linkedTitle`.
- `buildBlockPrefillFromMessage` trims whitespace, splits multi-line text into first-line title (capped at 60 chars) + remaining detail text.
- `getInvalidationKeysForRealtimeEvent(roomId, 'room_messages')` returns `[['room', roomId, 'messages']]`.
- Input validation in `chatHelpers`/`chat.ts` rejects empty/whitespace messages, >1000-char messages, empty report reasons, and self-blocking (`CANNOT_BLOCK_SELF`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx.cmd vitest run tests/lib/chatHelpers.test.ts tests/api/chat.test.ts`
Expected: FAIL (modules do not exist yet).

- [ ] **Step 3: Implement `chatHelpers.ts`, `chat.ts`, `queryClient.ts`, `realtimeHelpers.ts`, and `useRoomRealtime.ts`**

Keep `useRoomRealtime.ts` compile-time `_verifyRealtimeKeyCompatibility` check intact by updating `RealtimeQueryKey` union in `realtimeHelpers.ts` to match all keys in `QUERY_KEYS`. In `src/api/chat.ts`, validate all inputs via `chatHelpers` before calling Supabase RPCs/tables, and parse returned rows through `ChatMessageMetadataSchema`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx.cmd vitest run` and `npx.cmd tsc --noEmit`
Expected: PASS and 0 TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/chatHelpers.ts src/api/chat.ts src/lib/queryClient.ts src/hooks/realtimeHelpers.ts src/hooks/useRoomRealtime.ts tests/lib/chatHelpers.test.ts tests/api/chat.test.ts
git commit -m "feat(chat): add chat helpers, Supabase chat/compliance API layer, and Realtime wiring"
```

---

### Task 4: Block Reorder, Non-Host Leave Room, Native Invite Share & Activity Log Extensions

**Files:**
- Create: `src/lib/blockOrderHelpers.ts`
- Create: `src/lib/shareInvite.ts`
- Modify: `src/api/blocks.ts`
- Modify: `src/api/rooms.ts`
- Modify: `src/lib/activityLogHelpers.ts`
- Test: `tests/lib/blockOrderHelpers.test.ts`, `tests/lib/activityLogHelpers.test.ts`

**Interfaces:**
- Consumes: `buildShareMessage` (`src/lib/roomCode.ts`), `ParsedBlock`, `RoomApiError`, `toRoomApiError`.
- Produces:
  - `src/lib/blockOrderHelpers.ts`:
    - `moveBlockInOrder(blockIds: readonly string[], targetId: string, direction: 'up' | 'down'): string[] | null` (returns `null` when out-of-bounds or not found)
    - `applyBlockOrderToList<T extends { id: string; sort_order: number }>(blocks: readonly T[], orderedIds: readonly string[]): T[]`
  - `src/lib/shareInvite.ts`:
    - `shareRoomInvite(params: { title: string; roomCode: string; inviteUrl: string }): Promise<'shared' | 'copied'>` (tries React Native `Share.share`, falls back cleanly to `Clipboard.setStringAsync`)
  - `src/api/blocks.ts`: `reorderRoomBlocks(roomId: string, blockIds: readonly string[]): Promise<void>`
  - `src/api/rooms.ts`:
    - `createRoomWithTemplate` passes `p_chat_enabled: input.chatEnabled ?? null`
    - `updateRoomMetadata` supports `chat_enabled`, `event_start_at`, `event_end_at`
    - `leaveRoom(roomId: string): Promise<void>` calling `leave_room` RPC
  - `src/lib/activityLogHelpers.ts`: human-readable labels & snapshot summaries for `'delete_message'` (`删除聊天消息`) and `'leave_room'` (`退出房间`), both marked non-restorable (`canRestore: false`).

- [ ] **Step 1: Write failing tests in `tests/lib/blockOrderHelpers.test.ts` and extend `tests/lib/activityLogHelpers.test.ts`**

Test:
- `moveBlockInOrder(['a', 'b', 'c'], 'b', 'up')` → `['b', 'a', 'c']`; moving `'a'` up or `'c'` down returns `null`.
- `applyBlockOrderToList` re-indexes `sort_order` to `0, 1, 2...` without mutating original array.
- `activityLogHelpers` renders `delete_message` (previewing message content snippet from `before_snapshot`) and `leave_room` cleanly with `canRestore: false`.

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `npx.cmd vitest run tests/lib/blockOrderHelpers.test.ts tests/lib/activityLogHelpers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `blockOrderHelpers.ts`, `shareInvite.ts`, `blocks.ts`, `rooms.ts`, and `activityLogHelpers.ts`**

In `src/api/blocks.ts`, reject empty `blockIds` or duplicate IDs with `RoomApiError('INVALID_INPUT')` before invoking `reorder_room_blocks`. In `src/api/rooms.ts`, keep `updateRoomMetadata` sending only defined fields so partial updates remain safe.

- [ ] **Step 4: Run full tests and typecheck**

Run: `npx.cmd vitest run` and `npx.cmd tsc --noEmit`
Expected: PASS and 0 TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/blockOrderHelpers.ts src/lib/shareInvite.ts src/api/blocks.ts src/api/rooms.ts src/lib/activityLogHelpers.ts tests/lib/blockOrderHelpers.test.ts tests/lib/activityLogHelpers.test.ts
git commit -m "feat(rooms): add block reorder, non-host leave room, native invite share, and Stage 2 log labels"
```

---

## Milestone 2: Chat UI, Bidirectional Linkage & Room Experience Polish

### Task 5: `BlockReminderCard` & `ChatRoomView` Components (With Compliance & `@` Mentions)

**Files:**
- Create: `src/components/chat/BlockReminderCard.tsx`
- Create: `src/components/chat/ChatRoomView.tsx`

**Interfaces:**
- Consumes: `ParsedRoomMessage`, `ChatMessageMetadata`, `RoomMemberWithProfile`, `RoomPermissions`, `chatHelpers.ts`, `src/api/chat.ts`, `SheetModal`, `Button`, `Avatar`, `Badge`.
- Produces:
  - `BlockReminderCard`: props `{ metadata: ChatMessageMetadata; content: string; onPressBlock?: (blockId: string) => void }`.
  - `ChatRoomView`: props `{ roomId: string; messages: readonly ParsedRoomMessage[]; blockedUserIds: ReadonlySet<string>; members: readonly RoomMemberWithProfile[]; permissions: RoomPermissions; loading: boolean; refreshing: boolean; onRefresh: () => void; onJumpToBlock: (blockId: string) => void; onConvertMessageToBlock: (message: ParsedRoomMessage, target: 'task' | 'schedule') => void }`.

- [ ] **Step 1: Implement `src/components/chat/BlockReminderCard.tsx`**

Build a crisp tangerine-tinted card (`bg-primarySoft border-orange-200`) displaying block type icon (`poll` / `task`), `linkedTitle`, reminder body text, and `"前往处理 →"` pressable row calling `onPressBlock(metadata.linkedBlockId)` when present.

- [ ] **Step 2: Implement `src/components/chat/ChatRoomView.tsx`**

Build the complete single-handed chat view:
- Filters `messages` via `filterVisibleChatMessages(messages, blockedUserIds)` *(Review Focus #1)*.
- Renders chronological `FlatList` (auto-scrolls to newest on send/arrival) with sender avatar, nickname, formatted time, `@提及` highlight pill when `isCurrentUserMentioned` is true, `BlockReminderCard` for `msg_type === 'block_card'`, and muted pill for `msg_type === 'system'`.
- Bottom composer bar (replaced by a subtle archived read-only notice when `permissions.isArchived`):
  - `@` button opening a `SheetModal` member picker (shows `@全体成员` at top only when `permissions.canMentionAll`, plus active members excluding self; displays selected mention chips above input).
  - Optimistic send via `useMutation` + `appendOptimisticChatMessage`, rolling back and surfacing `mapRoomError(err)` on `CHAT_DISABLED` / `ROOM_ARCHIVED` / network error *(Review Focus #2)*.
- Long-press on any message opens a `SheetModal` action sheet:
  - `转为分工任务` (shown for `msg_type === 'text'` when `!permissions.isReadOnly`)
  - `加入日程轴` (shown for `msg_type === 'text'` when `!permissions.isReadOnly`)
  - `复制内容` (via `expo-clipboard`)
  - `举报消息` (shown when `permissions.canReportChatMessage(msg.sender_id)` → opens second `SheetModal` with `REPORT_REASON_PRESETS` + optional custom note → `reportRoomMessage`)
  - `屏蔽此人` (shown when `permissions.canBlockUser(msg.sender_id)` → confirmation `SheetModal` → `blockUser` → immediately updates `QUERY_KEYS.userBlocks(currentUserId)` and invalidates `QUERY_KEYS.roomMessages(roomId)`) *(Review Focus #1)*
  - `删除消息` (shown when `permissions.canDeleteChatMessage(msg.sender_id)` → confirmation → `softDeleteRoomMessage`)

- [ ] **Step 3: Run typecheck and tests**

Run: `npx.cmd tsc --noEmit` and `npx.cmd vitest run`
Expected: 0 TypeScript errors, all tests PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/components/chat/BlockReminderCard.tsx src/components/chat/ChatRoomView.tsx
git commit -m "feat(chat): implement ChatRoomView and BlockReminderCard with @mentions, report, and block"
```

---

### Task 6: Room Board Dual Tab, Unread Badge, Chat ↔ Block Linkage & Block Reorder UI

**Files:**
- Modify: `src/components/blocks/PollBlock.tsx`
- Modify: `src/components/blocks/TaskBlock.tsx`
- Modify: `src/components/blocks/ScheduleBlock.tsx`
- Modify: `src/components/blocks/ExpenseBlock.tsx`
- Modify: `app/room/[id]/index.tsx`

**Interfaces:**
- Consumes: `ChatRoomView`, `chatHelpers.ts`, `src/api/chat.ts`, `blockOrderHelpers.ts`, `reorderRoomBlocks`, `shareRoomInvite`.
- Produces:
  - Optional Stage 2 props on block components:
    - All 4 blocks: `highlighted?: boolean`, `reorderMode?: boolean`, `canMoveUp?: boolean`, `canMoveDown?: boolean`, `onMoveUp?: () => void`, `onMoveDown?: () => void`, `reordering?: boolean`.
    - `PollBlock` & `TaskBlock`: `onSendReminder?: () => void`, `sendingReminder?: boolean`.
    - `TaskBlock` & `ScheduleBlock`: `externalCreateDraft?: { nonce: number; title: string; details: string } | null`, `onConsumeExternalCreateDraft?: () => void`.
  - `app/room/[id]/index.tsx`: full dual-tab (`协作看板 | 聊天室`) container, unread count badge, bidirectional linkage, reorder mode toggle, and native invite share button.

- [ ] **Step 1: Add optional Stage 2 props to `PollBlock.tsx`, `TaskBlock.tsx`, `ScheduleBlock.tsx`, and `ExpenseBlock.tsx`**

- Apply subtle tangerine ring (`border-2 border-primary`) when `highlighted === true`.
- When `reorderMode === true`, render compact `ChevronUp` / `ChevronDown` buttons in the block header calling `onMoveUp` / `onMoveDown`.
- On `PollBlock` and `TaskBlock`, when `onSendReminder` is provided (host/admin + `chat_enabled` + active), render a compact `BellRing` button in the header to push a reminder card to chat.
- On `TaskBlock` and `ScheduleBlock`, watch `externalCreateDraft?.nonce` in a `useEffect`: when a new nonce arrives, prefill `title` + `description`/`notes`, open the block's existing Create `SheetModal`, and invoke `onConsumeExternalCreateDraft?.()`.

- [ ] **Step 2: Upgrade `app/room/[id]/index.tsx` with dual Tab, unread badge, bidirectional linkage, reorder mode & native share**

Wire:
- Queries for `roomMessages(roomId)`, `roomChatRead(roomId, currentUserId)`, and `userBlocks(currentUserId)` (messages & read queries enabled when `room?.chat_enabled`).
- Pass `chatEnabled: room?.chat_enabled ?? false` into `useRoomPermissions`.
- Segmented tab bar (`协作看板` | `聊天室`) rendered directly under the header ONLY when `room.chat_enabled === true`; defaults to `'board'`; auto-resets to `'board'` with toast `'房主已关闭聊天室'` if `room.chat_enabled` becomes `false` mid-session *(Review Focus #2)*.
- Compute unread count with `countUnreadChatMessages` (excluding self, deleted, blocked senders) and display numeric red badge (`99+` cap) on the `聊天室` tab while on `'board'` *(Review Focus #5)*.
- Entering `'chat'` (or receiving a new message while actively viewing `'chat'`) triggers debounced `markRoomChatRead` and optimistically sets `QUERY_KEYS.roomChatRead(roomId, currentUserId)`.
- **Card → Board jump**: track block `onLayout` `y` offsets in a ref; tapping a `BlockReminderCard` switches to `'board'`, scrolls `ScrollView` smoothly to the target block's `y`, and sets `highlightedBlockId` for 2000ms.
- **Chat → Block conversion** *(Review Focus #3)*:
  - Finds first existing `task` or `schedule` block.
  - If none exists and `permissions.canManageBlocks` is true, creates a default `'分工与物资认领'` or `'活动日程轴'` block first, invalidates `roomBlocks`, then triggers `externalCreateDraft` on the new block.
  - If none exists and user is a regular member, shows clear toast `'房间暂未添加分工/日程积木，请联系房主添加后再转换'`.
- **Board → Chat reminder**: builds payload with `buildBlockReminderMessage` and sends via `sendRoomMessage({ msgType: 'block_card', ... })`, showing toast `'已发送提醒到聊天室'`.
- **Reorder mode**: compact `"排序"` toggle button in the announcement/header toolbar (visible when `permissions.canReorderBlocks && blocks.length > 1`); moving a block optimistically updates `QUERY_KEYS.roomBlocks(roomId)` via `applyBlockOrderToList`, calls `reorderRoomBlocks`, and rolls back on error.
- **Native Share Invite**: add a quick share icon next to the room code badge calling `shareRoomInvite(...)`.

- [ ] **Step 3: Run full test suite & typecheck**

Run: `npx.cmd vitest run` and `npx.cmd tsc --noEmit`
Expected: PASS and 0 TypeScript errors.

- [ ] **Step 4: Commit**

```powershell
git add src/components/blocks/PollBlock.tsx src/components/blocks/TaskBlock.tsx src/components/blocks/ScheduleBlock.tsx src/components/blocks/ExpenseBlock.tsx "app/room/[id]/index.tsx"
git commit -m "feat(board): integrate dual-tab chat, unread badge, chat-block linkage, and block reordering"
```

---

### Task 7: Room Create, Room Settings, Activity Logs & Profile Blocked-Users Management

**Files:**
- Modify: `app/room/create.tsx`
- Modify: `app/room/[id]/settings.tsx`
- Modify: `app/room/[id]/logs.tsx`
- Modify: `app/(tabs)/profile.tsx`

**Interfaces:**
- Consumes: `ROOM_TEMPLATES[type].chatEnabled`, `createRoomWithTemplate`, `updateRoomMetadata`, `leaveRoom`, `shareRoomInvite`, `fetchMyBlockedUsers`, `unblockUser`, updated `activityLogHelpers.ts`.
- Produces: Complete end-to-end UI controls for creating/toggling chat, editing event windows (for 7-day auto-archive), native sharing, non-host leaving rooms, viewing Stage 2 audit logs, and unblocking users.

- [ ] **Step 1: Add `房间聊天室` toggle to `app/room/create.tsx`**

- Add `chatEnabled` state initialized to `ROOM_TEMPLATES.campus.chatEnabled` (`true`) plus a `chatManuallyToggled` flag so switching templates auto-applies `ROOM_TEMPLATES[nextType].chatEnabled` (`campus`/`travel` ON, `party`/`custom` OFF) unless the user manually flipped the switch.
- Pass `chatEnabled` to `createRoomWithTemplate`.

- [ ] **Step 2: Upgrade `app/room/[id]/settings.tsx`**

- Add `开启房间聊天室` `Switch` (included in `updateRoomMetadata` dirty check & save).
- Add editable `活动开始时间` and `活动结束时间` inputs (same `YYYY-MM-DD HH:mm` format as `create.tsx`, with clear caption *"活动结束 7 天后系统将自动归档为只读"*).
- Add `"分享邀请"` button using `shareRoomInvite` alongside existing `"复制邀请"` button.
- For non-host active members (`permissions.canLeaveRoom`), render a danger-outlined `"退出房间"` card at the bottom opening a confirmation `SheetModal` → calls `leaveRoom(room.id)` → invalidates `QUERY_KEYS.rooms(currentUserId)` and navigates to `/(tabs)` with toast `'已退出该房间'` *(Review Focus #4)*.

- [ ] **Step 3: Update `app/room/[id]/logs.tsx`**

Ensure the timeline icon/badge mapping handles `'delete_message'` and `'leave_room'` cleanly (with distinct icons and neutral/warning badges, no restore button).

- [ ] **Step 4: Add "已屏蔽用户" management section to `app/(tabs)/profile.tsx`**

- Query `QUERY_KEYS.userBlocks(userId)` via `fetchMyBlockedUsers(userId)`.
- Render a collapsible `"已屏蔽用户 (N)"` card listing each blocked user's avatar & nickname with an `"解除屏蔽"` button calling `unblockUser(blockedId)` and invalidating `userBlocks(userId)` plus all `roomMessages` queries *(Review Focus #1)*.

- [ ] **Step 5: Run full tests and typecheck**

Run: `npx.cmd vitest run` and `npx.cmd tsc --noEmit`
Expected: PASS and 0 TypeScript errors.

- [ ] **Step 6: Commit**

```powershell
git add app/room/create.tsx "app/room/[id]/settings.tsx" "app/room/[id]/logs.tsx" "app/(tabs)/profile.tsx"
git commit -m "feat(screens): wire chat toggle, event window edit, native share, leave room, and unblock UI"
```

---

### Task 8: Stage 2 Dual-Phone Expo Go Verification Checklist & Final Verification Gate

**Files:**
- Create: `docs/superpowers/verification/stage2-device-checklist.md`

**Interfaces:**
- Consumes: All Stage 2 SQL migrations, APIs, components, and screens from Tasks 1–7.
- Produces: Complete dual-phone Expo Go acceptance checklist for Stage 2 + verified green full test suite & typecheck.

- [ ] **Step 1: Write `docs/superpowers/verification/stage2-device-checklist.md`**

Cover concrete step-by-step dual-phone (Phone A Host / Phone B Member) Expo Go checks:
1. Pre-flight: `004` & `005` migrations executed, `pg_cron` enabled (or manual `SELECT public.auto_archive_expired_rooms()` test), `vitest run` + `tsc --noEmit` green.
2. Template default `chat_enabled` (`campus`/`travel` ON, `party`/`custom` OFF) + live toggle in `settings.tsx` bouncing Phone B back to Board when turned off.
3. Realtime messaging, unread badge accuracy (excluding self & blocked senders), `@member` / `@全体成员` permissions, and read cursor persistence across app restarts.
4. Bidirectional linkage: long-press text → `转为分工任务` / `加入日程轴` (including `party` room without Task/Schedule block), and Poll/Task reminder card jumping back to Board + highlighting target block.
5. UGC compliance: host/sender delete message (logged in `logs.tsx`), report message (`message_reports`), block user (instant hide + Realtime non-leak + unblock from `profile.tsx`).
6. Lifecycle & polish: block up/down reordering synced across phones, non-host `leave_room` + host blocked (`HOST_CANNOT_LEAVE`), native `Share.share` invite, editable event end time + `auto_archive_expired_rooms()` switching both phones to read-only (including Chat tab).

- [ ] **Step 2: Run full verification gate**

Run:
```powershell
npx.cmd vitest run
npx.cmd tsc --noEmit
git status
```
Expected: All Vitest suites PASS (0 failures), `tsc --noEmit` exits 0 with 0 errors, working tree clean after commit.

- [ ] **Step 3: Commit**

```powershell
git add docs/superpowers/verification/stage2-device-checklist.md
git commit -m "docs(verification): add Stage 2 dual-phone Expo Go acceptance checklist"
```
