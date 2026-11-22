# 轻橘 PopRoom 第一阶段 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Stage 1 MVP of **轻橘 PopRoom** — a lightweight Expo Go-verifiable mobile collaboration app backed by Supabase for 3–20 person events covering auth, 4-template room creation, 6-char room code 2-tier entry gate, 4 real-time collaboration blocks (poll/heatmap, task, schedule, budget/AA expense), soft-delete activity logs with host undo, manual archive lock, and PNG/PDF recap export.

**Architecture:** Supabase-first atomic write boundary (Approach A): all multi-table, concurrent, or permission-sensitive mutations run through PostgreSQL `SECURITY DEFINER` RPCs (`SET search_path = public`) with row-level locks, while reads and creator/admin single-item edits go through PostgREST + strict RLS (with archive write lock and `poll_votes` privacy isolation) and room-scoped Realtime subscriptions. The Expo Router React Native client enforces strict TypeScript + Zod contracts at the data boundary and uses TanStack Query v5 with AsyncStorage persistence for optimistic updates and offline reading.

**Tech Stack:** Expo (SDK 52+, Expo Go compatible), React Native, Expo Router, TypeScript (Strict Mode), NativeWind v4, `lucide-react-native`, `@gorhom/bottom-sheet`, TanStack Query v5 + AsyncStorage persister, Zustand, Supabase (PostgreSQL, Auth, Realtime, Storage) + `expo-secure-store`, Zod, `expo-linking`, `expo-image-picker`, `expo-clipboard`, `react-native-view-shot`, `expo-print`, `expo-sharing`, Vitest.

**Spec:** [docs/superpowers/specs/2026-11-22-poproom-mvp-design.md](../specs/2026-11-22-poproom-mvp-design.md)

## Global Constraints

- **Expo Go Compatibility:** Every dependency and feature in Stage 1 MUST run inside Expo Go (SDK 52+); do NOT add native-only modules requiring custom Dev Builds (no `expo-notifications` remote push setup, no native Chinese map SDKs, no Apple/WeChat native login).
- **Strict Type Safety:** `tsconfig.json` MUST enable `"strict": true`; zero `any` anywhere in `src/` or `app/`; all `blocks.config` and `block_items.data` payloads MUST pass through Zod schemas in `src/schemas/blocks.ts`.
- **Auth Mode (Stage 1):** Email + Password via Supabase Auth with "Confirm Email" disabled in Supabase Auth settings (avoids ~2 emails/hr free-tier SMTP rate limit); session persisted via `expo-secure-store`.
- **Single-Handed Mobile UX:** High-frequency actions (voting, claiming tasks, logging expenses, creating/editing items, choosing map apps) MUST use `@gorhom/bottom-sheet`; warm tangerine light palette (`#F97316` primary, `#FFF7ED` soft tint, `#F8FAFC` page background, `#18181B` primary ink).
- **Unified 6-Char Room Code:** Globally unique 6-character uppercase code from the 32-char non-confusable alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (excludes `0/O/1/I`); deep link scheme `"poproom"`.
- **Archive Immutability:** When `rooms.status = 'archived'`, ALL write RLS policies and write RPCs MUST reject mutations (`ROOM_ARCHIVED`), and the UI MUST switch to read-only mode (exporting recap remains allowed).
- **Deferred Stage 2 Hooks Only:** Reserve `rooms.chat_enabled` (default `false` across all Stage 1 templates) and `profiles.expo_push_token`; do NOT build Chat Room UI, Push Edge Functions, `pg_cron`, or UGC report/block screens in Stage 1.
- **Windows Shell Command Note:** On this workspace, invoke `npm.cmd` and `npx.cmd` in PowerShell (direct `npm.ps1` is blocked by execution policy).

## Review Focus

1. **Dirty or confusable room code input (`" k7m-3p9 "`, lowercase, `0/O/1/I`, wrong length):** Pasting a code from WeChat with spaces/hyphens or typing lowercase must normalize cleanly to `"K7M3P9"`, while confusable characters or wrong length must be rejected before hitting the network *(pinned in Task 3)*.
2. **AA split rounding & zero-sum conservation (`100.00 / 3`, `0.01 / 3`, payer not in `participantIds`):** Integer-cent math must distribute remainder cents deterministically so total debits strictly equal total credits, never emit self-transfers (`fromUserId === toUserId`), and handle paying on behalf of others *(pinned in Task 4)*.
3. **Anonymous poll privacy & Realtime non-leakage (`anonymous: true`):** `poll_votes` must never join `supabase_realtime`, `get_room_poll_tallies` must mask `voter_ids` to `[]` even for host/admin, and client helpers must strip any voter identifiers before rendering *(pinned in Task 2 & Task 8)*.
4. **Mid-session room archival while another member acts:** If a host archives a room while a member is actively viewing it, `useRoomPermissions` must flip all write capabilities to `false` (keeping export `true`), and optimistic mutation errors (`ROOM_ARCHIVED`) must roll back cleanly *(pinned in Task 2, Task 4 & Task 12)*.
5. **Unauthenticated Deep Link handoff (`poproom://room/join?code=XXXXXX`):** A new user tapping an invite link must keep the target `roomCode` across `login` → `onboarding`, land on `/room/join?code=XXXXXX` once profiled, and clear the stored pending code *(pinned in Task 5)*.

---

## File Structure Map

```text
PopRoom/
├── app.json                                  # Expo config (scheme: "poproom", plugins)
├── babel.config.js / metro.config.js         # NativeWind v4 + Reanimated config
├── tailwind.config.js / global.css           # Tangerine theme tokens & Tailwind entry
├── tsconfig.json / vitest.config.ts          # Strict TS & Vitest unit test runner
├── .env.example                              # EXPO_PUBLIC_SUPABASE_URL / ANON_KEY
├── supabase/
│   ├── README.md                             # Exact Supabase setup & Auth toggle guide
│   └── migrations/
│       ├── 001_initial_schema.sql            # 8 tables, indexes, Realtime (excl. poll_votes)
│       ├── 002_rls_policies.sql              # Security helpers, RLS policies, room-media bucket
│       └── 003_rpcs.sql                      # 14 atomic SECURITY DEFINER RPCs
├── src/
│   ├── types/database.ts                     # Strict TS row & RPC response interfaces
│   ├── schemas/blocks.ts                     # Single source of truth Zod schemas for 4 blocks
│   ├── lib/
│   │   ├── supabase.ts                       # Supabase client + SecureStore adapter
│   │   ├── queryClient.ts                    # TanStack QueryClient + AsyncStorage persister
│   │   ├── roomCode.ts                       # 6-char room code normalization, links, share text
│   │   ├── templates.ts                      # 4 preset templates (campus/travel/party/custom)
│   │   ├── splitAlgorithm.ts                 # Integer-cent balances & greedy minimal transfers
│   │   ├── mapNavigation.ts                  # Amap/Baidu/Apple/Web keyword URI builders
│   │   ├── mediaUpload.ts                    # Image picker, 5MB guard, room-media upload & signed URLs
│   │   ├── pollHelpers.ts                    # Optimistic poll tally, heatmap matrix, anonymous sanitizer
│   │   ├── taskHelpers.ts                    # Optimistic task claim/status & 3-photo cap helpers
│   │   ├── scheduleHelpers.ts                # Timeline grouping & startTime sorting
│   │   ├── activityLogHelpers.ts             # Human-readable log labels & restore eligibility
│   │   └── recapBuilder.ts                   # Recap aggregator & escaped HTML generator for PDF
│   ├── stores/
│   │   ├── authStore.ts                      # Session, profile, pendingRoomCode & redirect resolver
│   │   └── uiStore.ts                        # Ephemeral toast/banner state
│   ├── api/
│   │   ├── rooms.ts                          # Room queries, RPC wrappers & domain error mapper
│   │   └── blocks.ts                         # Block/item/tally/comment/log queries & mutations
│   ├── hooks/
│   │   ├── useRoomPermissions.ts             # Role + archived + task-owner permission engine
│   │   └── useRoomRealtime.ts                # Room-scoped Realtime channel -> Query invalidation
│   └── components/
│       ├── ui/                               # Button, Card, Avatar, Badge, SheetModal
│       └── blocks/                           # PollBlock, TaskBlock, ScheduleBlock, ExpenseBlock
├── app/
│   ├── _layout.tsx                           # Providers, Auth + DeepLink route guard
│   ├── (auth)/login.tsx & onboarding.tsx     # Email+Password auth & nickname/color setup
│   ├── (tabs)/_layout.tsx, index.tsx, profile.tsx
│   └── room/
│       ├── create.tsx & join.tsx             # Template create & 6-char join / approval wait
│       └── [id]/index.tsx, settings.tsx, logs.tsx, export.tsx
├── docs/superpowers/verification/
│   └── stage1-device-checklist.md            # Dual-phone Expo Go acceptance checklist
└── tests/                                    # Vitest unit & contract suites mirroring src/ & supabase/
```

---

## Milestone 1: Foundation, Supabase Backend, Auth, Lobby & Room Gate

### Task 1: Project Scaffold, Strict TypeScript, NativeWind v4 & Test Harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `app.json`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`, `global.css`, `nativewind-env.d.ts`, `vitest.config.ts`, `.env.example`, `.gitignore`
- Create: `src/types/database.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: None
- Produces:
  - `src/types/database.ts`: strict TypeScript types `RoomStatus`, `JoinMode`, `TemplateType`, `MemberRole`, `MemberStatus`, `BlockType`, `ActivityAction`, `ProfileRow`, `RoomRow`, `RoomMemberRow`, `BlockRow`, `BlockItemRow`, `ItemCommentRow`, `ActivityLogRow`, `PollTallyRow`, `JoinRoomResult`.
  - Working `npm.cmd test` (Vitest) and `npx.cmd tsc --noEmit` commands.

- [ ] **Step 1: Initialize Git repository and commit existing docs**

Run:
```powershell
git init
git add app.md docs/
git commit -m "docs: add PopRoom spec and Stage 1 MVP design doc"
```
Expected: Clean initial commit on `main`/`master` containing `app.md` and `docs/`.

- [ ] **Step 2: Scaffold Expo SDK 52+ Router TypeScript project and install locked dependencies**

Initialize Expo project files in `d:\PopRoom` (preserving `app.md` and `docs/`) and install dependencies via `npx.cmd expo install` / `npm.cmd install`:
- Core & UI: `expo`, `expo-router`, `react`, `react-native`, `nativewind`, `tailwindcss`, `lucide-react-native`, `@gorhom/bottom-sheet`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-safe-area-context`, `react-native-screens`, `react-native-svg`
- Data & Auth: `@supabase/supabase-js`, `expo-secure-store`, `@tanstack/react-query`, `@tanstack/query-async-storage-persister`, `@react-native-async-storage/async-storage`, `zustand`, `zod`
- Device & Export: `expo-linking`, `expo-image-picker`, `expo-clipboard`, `react-native-view-shot`, `expo-print`, `expo-sharing`, `expo-constants`
- Dev: `typescript`, `vitest`, `@types/react`

Configure `app.json` (`scheme: "poproom"`, `name: "轻橘 PopRoom"`, `slug: "poproom"`), `tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess: true`, `@/*` path alias to `./*`), NativeWind v4 (`tailwind.config.js` with `primary: '#F97316'`, `primarySoft: '#FFF7ED'`, `surface: '#F8FAFC'`, `ink: '#18181B'`), `vitest.config.ts`, `.env.example`, and `.gitignore` (ignoring `.env`, `node_modules`, `.expo`).

- [ ] **Step 3: Write failing smoke test for database types & toolchain**

Create `tests/smoke.test.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it fails before `src/types/database.ts` exists**

Run: `npx.cmd vitest run tests/smoke.test.ts`
Expected: FAIL (cannot resolve `../src/types/database`).

- [ ] **Step 5: Implement `src/types/database.ts`**

Define all strict union types and row/RPC interfaces matching Spec Section 5.3 (`ProfileRow`, `RoomRow`, `RoomMemberRow`, `RoomMemberWithProfile`, `BlockRow`, `BlockItemRow`, `ItemCommentRow`, `ItemCommentWithProfile`, `ActivityLogRow`, `PollTallyRow`, `JoinRoomResult`). Use `unknown` (never `any`) for raw `config`, `data`, and `before_snapshot` JSONB columns prior to Zod parsing.

- [ ] **Step 6: Verify tests and strict typecheck pass**

Run: `npx.cmd vitest run tests/smoke.test.ts` and `npx.cmd tsc --noEmit`
Expected: `tests/smoke.test.ts` PASS; `tsc --noEmit` exits 0 with zero errors.

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "chore: scaffold Expo SDK 52+ project with NativeWind v4, Vitest, and database types"
```

---

### Task 2: Supabase Schema, RLS Policies, Atomic RPCs & Storage Migrations

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`
- Create: `supabase/migrations/002_rls_policies.sql`
- Create: `supabase/migrations/003_rpcs.sql`
- Create: `supabase/README.md`
- Test: `tests/supabase/migrations.test.ts`

**Interfaces:**
- Consumes: Spec Section 5.2, 5.3, 5.5, 5.6
- Produces:
  - Tables: `profiles`, `rooms`, `room_members`, `blocks`, `block_items`, `poll_votes`, `item_comments`, `activity_logs`
  - Bucket: `room-media` (private)
  - RPCs (exact names & parameters):
    - `create_room_with_template(p_title TEXT, p_template_type TEXT, p_join_mode TEXT, p_announcement TEXT DEFAULT '', p_event_start_at TIMESTAMPTZ DEFAULT NULL, p_event_end_at TIMESTAMPTZ DEFAULT NULL) RETURNS rooms`
    - `join_room_by_code(p_room_code TEXT, p_apply_note TEXT DEFAULT NULL) RETURNS JSONB`
    - `review_member_application(p_room_id UUID, p_target_user_id UUID, p_decision TEXT) RETURNS room_members`
    - `update_member_role(p_room_id UUID, p_target_user_id UUID, p_role TEXT) RETURNS room_members`
    - `kick_room_member(p_room_id UUID, p_target_user_id UUID) RETURNS VOID`
    - `reset_room_code(p_room_id UUID) RETURNS TEXT`
    - `toggle_poll_vote(p_item_id UUID) RETURNS TABLE (item_id UUID, block_id UUID, vote_count INT, my_voted BOOLEAN, voter_ids UUID[])`
    - `get_room_poll_tallies(p_room_id UUID) RETURNS TABLE (item_id UUID, block_id UUID, vote_count INT, my_voted BOOLEAN, voter_ids UUID[])`
    - `toggle_task_claim(p_item_id UUID) RETURNS block_items`
    - `set_task_status(p_item_id UUID, p_status TEXT) RETURNS block_items`
    - `update_task_images(p_item_id UUID, p_image_urls TEXT[]) RETURNS block_items`
    - `soft_delete_block_item(p_item_id UUID) RETURNS UUID`
    - `restore_deleted_item(p_log_id UUID) RETURNS block_items`
    - `archive_room(p_room_id UUID) RETURNS rooms`

- [ ] **Step 1: Write failing SQL contract tests (including Review Focus #3 and #4)**

Create `tests/supabase/migrations.test.ts` asserting over the 3 migration files:
- `001_initial_schema.sql`: defines all 8 tables, `room_code TEXT UNIQUE NOT NULL`, `chat_enabled BOOLEAN NOT NULL DEFAULT FALSE`, `poll_votes` with `UNIQUE (item_id, user_id)`, and `ALTER PUBLICATION supabase_realtime ADD TABLE` includes `rooms`, `room_members`, `blocks`, `block_items`, `item_comments` and **strictly excludes `poll_votes`** (Review Focus #3).
- `002_rls_policies.sql`: enables RLS on all 8 tables, defines `is_active_member`, `is_room_admin`, `is_room_host`, `is_room_active`, `is_poll_anonymous` with `SECURITY DEFINER` + `SET search_path = public`, enforces `is_room_active` on all write policies (Review Focus #4), restricts `block_items` UPDATE to `created_by = auth.uid() OR is_room_admin(room_id)`, omits direct DELETE policy on `block_items` and direct write policies on `poll_votes`, and creates `room-media` private storage bucket + RLS policies.
- `003_rpcs.sql`: defines all 14 RPCs with `SECURITY DEFINER` and `SET search_path = public`, uses 32-char alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` in `generate_unique_room_code`, checks `ROOM_ARCHIVED` in mutating RPCs (Review Focus #4), masks `voter_ids` to `'{}'::uuid[]` when `anonymous` is true in `get_room_poll_tallies` and `toggle_poll_vote` (Review Focus #3), uses `FOR UPDATE` in `toggle_task_claim`, `set_task_status`, `update_task_images`, and validates max 3 URLs in `update_task_images`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/supabase/migrations.test.ts`
Expected: FAIL (`ENOENT` on migration files).

- [ ] **Step 3: Write `supabase/migrations/001_initial_schema.sql`**

Create the 8 tables, foreign keys, `CHECK` constraints, indexes (`idx_room_members_user`, `idx_room_members_room`, `idx_blocks_room`, `idx_block_items_room`, `idx_poll_votes_room_block`, `idx_poll_votes_block_user`, `idx_item_comments_item`, `idx_activity_logs_room`), and Realtime publication (`rooms, room_members, blocks, block_items, item_comments` — NOT `poll_votes`).

- [ ] **Step 4: Write `supabase/migrations/002_rls_policies.sql`**

Implement the 5 `SECURITY DEFINER` helper functions (`SET search_path = public`), enable RLS and write minimal strict policies for all 8 tables per Spec Section 5.3 B (including `profiles` read access for co-members and pending-applicant admins, `room_members` self-read for waiting screen, archive write-lock via `is_room_active(room_id)`, no direct `DELETE` on `block_items`, no direct writes on `poll_votes` or `activity_logs`), plus idempotent creation of private bucket `room-media` in `storage.buckets` and `storage.objects` policies verifying `is_active_member((storage.foldername(name))[1]::uuid)`.

- [ ] **Step 5: Write `supabase/migrations/003_rpcs.sql` and `supabase/README.md`**

Implement `generate_unique_room_code()` (looping with `gen_random_bytes` over `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` until no collision in `rooms.room_code`) and all 14 RPCs per Spec Section 5.3 C:
- Error codes raised consistently as uppercase tokens: `NOT_AUTHENTICATED`, `PROFILE_REQUIRED`, `ROOM_NOT_FOUND`, `ROOM_ARCHIVED`, `USER_KICKED`, `NOT_A_MEMBER`, `FORBIDDEN`, `INVALID_INPUT`, `POLL_LOCKED`, `POLL_EXPIRED`, `ITEM_NOT_FOUND`, `LOG_ALREADY_RESTORED`, `MAX_IMAGES_EXCEEDED`.
- `join_room_by_code`: normalizes input (`upper(regexp_replace(p_room_code, '[\s-]+', '', 'g'))`), rejects `kicked`, returns existing `active` or `pending`, allows `rejected` user to re-apply in `approval` mode by updating to `pending` and refreshing `apply_note`.
- `toggle_poll_vote`: locks block/item, enforces `isLocked` and `deadline`, clears prior votes in same `block_id` when `multiple = false`, toggles `poll_votes`, updates `block_items.updated_at = NOW()` to trigger Realtime, returns tallies with `voter_ids = '{}'::uuid[]` whenever `anonymous = true`.
- `toggle_task_claim` / `set_task_status` / `update_task_images`: `SELECT * INTO v_item FROM block_items WHERE id = p_item_id AND is_deleted = FALSE FOR UPDATE`, verifies parent block `type = 'task'`, applies exact assignee/status/image rules from Spec Section 5.3 C.
- `create_room_with_template`: inserts `rooms` (`chat_enabled = FALSE`), inserts host row into `room_members`, inserts preset `blocks` for `campus`, `travel`, `party`, or none for `custom`.
- Write `supabase/README.md` with step-by-step instructions to create a Supabase project, run `001` → `002` → `003` in SQL Editor, disable "Confirm Email" under Authentication → Providers → Email, and configure `.env`.

- [ ] **Step 6: Run migration contract tests to verify they pass**

Run: `npx.cmd vitest run tests/supabase/migrations.test.ts`
Expected: PASS (all contract assertions green).

- [ ] **Step 7: Commit**

```powershell
git add supabase/ tests/supabase/migrations.test.ts
git commit -m "feat(db): add Supabase schema, RLS policies, room-media bucket, and atomic RPCs"
```

---

### Task 3: Zod Block Schemas, 6-Char Room Code Utilities & Scenario Templates

**Files:**
- Create: `src/schemas/blocks.ts`
- Create: `src/lib/roomCode.ts`
- Create: `src/lib/templates.ts`
- Test: `tests/lib/schemasAndRoomCode.test.ts`

**Interfaces:**
- Consumes: `src/types/database.ts` (`BlockType`, `TemplateType`)
- Produces:
  - `src/schemas/blocks.ts`: `PollConfigSchema`, `PollItemDataSchema`, `TaskConfigSchema`, `TaskItemDataSchema`, `ScheduleConfigSchema`, `ScheduleItemDataSchema`, `ExpenseConfigSchema`, `ExpenseItemDataSchema`, `PollTallySchema`, inferred TS types (`PollConfig`, `PollItemData`, `TaskConfig`, `TaskItemData`, `ScheduleConfig`, `ScheduleItemData`, `ExpenseConfig`, `ExpenseItemData`, `PollTally`), `parseBlockConfig(type: BlockType, raw: unknown)`, `parseBlockItemData(type: BlockType, raw: unknown)`.
  - `src/lib/roomCode.ts`: `ROOM_CODE_ALPHABET`, `normalizeRoomCode(raw: string): string`, `isValidRoomCode(raw: string): boolean`, `buildInviteLink(roomCode: string, scheme?: string): string`, `extractRoomCodeFromUrl(url: string): string | null`, `buildShareMessage(roomTitle: string, roomCode: string, inviteUrl: string): string`.
  - `src/lib/templates.ts`: `TemplatePreset`, `ROOM_TEMPLATES: Record<TemplateType, TemplatePreset>`, `TEMPLATE_LIST: TemplatePreset[]`.

- [ ] **Step 1: Write failing tests covering schemas, templates, and Review Focus #1**

Create `tests/lib/schemasAndRoomCode.test.ts`:
- `normalizeRoomCode(" k7m-3p9 ") === "K7M3P9"` and `isValidRoomCode(" k7m-3p9 ") === true`.
- Rejects confusable chars (`"K7M0P9"`, `"K7MOP9"`, `"K7M1P9"`, `"K7MIP9"`), wrong length (`"K7M3P"`, `"K7M3P99"`), and symbols (`"K7M@P9"`).
- `extractRoomCodeFromUrl("poproom://room/join?code=k7m3p9") === "K7M3P9"` and returns `null` for unrelated URLs or invalid codes.
- `PollItemDataSchema` accepts `{ label: "周六下午", slotDate: "2026-11-28", slotPeriod: "afternoon" }` and does NOT expose `voterIds`.
- `TaskItemDataSchema` rejects >3 `imageUrls`; `ExpenseItemDataSchema` rejects `amount <= 0` and empty `participantIds`; `ScheduleItemDataSchema` accepts plain-text `locationName` with omitted `latitude`/`longitude`.
- `ROOM_TEMPLATES`: `campus` has 4 blocks (`availability` poll → task → schedule → `budget` expense), `travel` has 4 blocks (`option` poll → schedule → task → `split` expense), `party` has 2 blocks (`option` poll → `split` expense), `custom` has 0 blocks; all have `chatEnabled: false`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/lib/schemasAndRoomCode.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `src/schemas/blocks.ts`, `src/lib/roomCode.ts`, and `src/lib/templates.ts`**

Implement exact Zod schemas matching Spec Section 5.4 (with `PollItemDataSchema` stripped of `voterIds`), 6-char room code regex `/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/` after stripping `[\s-]+` and uppercasing, and `ROOM_TEMPLATES` matching Spec Section 5.5.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx.cmd vitest run tests/lib/schemasAndRoomCode.test.ts` and `npx.cmd tsc --noEmit`
Expected: PASS, 0 TS errors.

- [ ] **Step 5: Commit**

```powershell
git add src/schemas/blocks.ts src/lib/roomCode.ts src/lib/templates.ts tests/lib/schemasAndRoomCode.test.ts
git commit -m "feat(domain): add Zod block schemas, 6-char room code utils, and preset templates"
```

---

### Task 4: AA Split Algorithm, Map Navigation URIs & Room Permission Engine

**Files:**
- Create: `src/lib/splitAlgorithm.ts`
- Create: `src/lib/mapNavigation.ts`
- Create: `src/hooks/useRoomPermissions.ts`
- Test: `tests/lib/splitAlgorithm.test.ts`
- Test: `tests/lib/mapNavigation.test.ts`
- Test: `tests/hooks/useRoomPermissions.test.ts`

**Interfaces:**
- Consumes: `src/types/database.ts` (`MemberRole`, `RoomStatus`)
- Produces:
  - `src/lib/splitAlgorithm.ts`: `ExpenseInput`, `MemberBalance { userId: string; netCents: number }`, `TransferRecord { fromUserId: string; toUserId: string; amountCents: number }`, `computeExpenseBalances(expenses: ExpenseInput[]): MemberBalance[]`, `computeMinimalTransfers(expenses: ExpenseInput[]): { balances: MemberBalance[]; transfers: TransferRecord[]; totalSpentCents: number }`, `formatCents(cents: number, currency?: string): string`.
  - `src/lib/mapNavigation.ts`: `MapProviderId = 'amap' | 'baidu' | 'apple' | 'web'`, `MapNavigationOption { id: MapProviderId; label: string; url: string; fallbackUrl: string }`, `buildMapNavigationOptions(locationName: string, platform: 'ios' | 'android' | 'web'): MapNavigationOption[]`.
  - `src/hooks/useRoomPermissions.ts`: `RoomPermissions`, `computeRoomPermissions(input: { role: MemberRole | null; roomStatus: RoomStatus; currentUserId: string | null; allowMemberCreatePoll: boolean }): RoomPermissions`, `useRoomPermissions(...)`.

- [ ] **Step 1: Write failing unit tests (pinning Review Focus #2 and #4)**

Create:
- `tests/lib/splitAlgorithm.test.ts`:
  - `100.00` CNY paid by A split among `[A, B, C]` → balances sum to `0` (`A: +6666, B: -3333, C: -3333` when remainder goes to first participant A, or verified exact deterministic rule: remainder `r` distributed +1 cent to first `r` entries in `participantIds`), transfers total `6666` cents, no self-transfer.
  - `0.01` CNY paid by A split among `[A, B, C]` → zero-sum conservation holds, no negative/zero transfers.
  - Payer `D` pays `60.00` CNY for `[A, B]` (payer NOT in `participantIds`) → `D: +6000`, `A: -3000`, `B: -3000`, 2 transfers `A->D 3000`, `B->D 3000`.
  - Multi-expense chain (`A` pays `90` for `[A,B,C]`, `B` pays `30` for `[A,B,C]`) minimizes to 2 transfers instead of pairwise mesh.
- `tests/lib/mapNavigation.test.ts`:
  - Encodes Chinese location `"紫竹院公园东门"` safely in Amap (`iosamap://` on iOS, `androidamap://` on Android), Baidu (`baidumap://`), Apple Maps (`maps://` on iOS only), and web fallback URL; returns `[]` for blank/whitespace `locationName`.
- `tests/hooks/useRoomPermissions.test.ts`:
  - Verifies every cell of Spec Section 5.6 permission matrix (`host`, `admin`, `member`, `archived` override).
  - Verifies helper methods `canEditOrDeleteItem(createdBy)`, `canSetTaskStatus(createdBy, assigneeIds)`, `canManageTaskImages(createdBy, assigneeIds)` return `true` for assignee/creator/admin on active rooms and `false` for all roles when `roomStatus === 'archived'` (Review Focus #4), while `canExportRecap` remains `true` when archived.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx.cmd vitest run tests/lib/splitAlgorithm.test.ts tests/lib/mapNavigation.test.ts tests/hooks/useRoomPermissions.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `src/lib/splitAlgorithm.ts`, `src/lib/mapNavigation.ts`, and `src/hooks/useRoomPermissions.ts`**

- In `splitAlgorithm.ts`: convert `Math.round(exp.amount * 100)` to integer cents; credit `paidByUserId`; debit each participant `Math.floor(cents / n)` plus `1` cent for index `< cents % n`; partition into positive creditors and negative debtors sorted descending by magnitude; greedy two-pointer settle emitting `{ fromUserId, toUserId, amountCents }`.
- In `mapNavigation.ts`: construct keyword-search deep links (`iosamap://poi?sourceApplication=poproom&name=...`, `androidamap://poi?sourceApplication=poproom&keywords=...`, `baidumap://map/place/search?query=...`, `maps://?q=...`, and web Amap/OSM fallback).
- In `useRoomPermissions.ts`: implement pure `computeRoomPermissions` matching Spec Section 5.6 verbatim and wrap with `useMemo` in `useRoomPermissions`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx.cmd vitest run tests/lib/splitAlgorithm.test.ts tests/lib/mapNavigation.test.ts tests/hooks/useRoomPermissions.test.ts` and `npx.cmd tsc --noEmit`
Expected: PASS, 0 TS errors.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/splitAlgorithm.ts src/lib/mapNavigation.ts src/hooks/useRoomPermissions.ts tests/lib/splitAlgorithm.test.ts tests/lib/mapNavigation.test.ts tests/hooks/useRoomPermissions.test.ts
git commit -m "feat(core): add AA minimal split algorithm, map navigation URIs, and room permission engine"
```

---

### Task 5: Supabase Client, Auth Store, Offline Query Persister, UI Atoms & Root Auth/DeepLink Guard

**Files:**
- Create: `src/lib/supabase.ts`
- Create: `src/lib/queryClient.ts`
- Create: `src/stores/authStore.ts`
- Create: `src/stores/uiStore.ts`
- Create: `src/components/ui/Button.tsx`, `src/components/ui/Card.tsx`, `src/components/ui/Avatar.tsx`, `src/components/ui/Badge.tsx`, `src/components/ui/SheetModal.tsx`
- Create: `app/_layout.tsx`, `app/(auth)/login.tsx`, `app/(auth)/onboarding.tsx`
- Test: `tests/stores/authRedirect.test.ts`

**Interfaces:**
- Consumes: `src/types/database.ts`, `src/lib/roomCode.ts` (`extractRoomCodeFromUrl`)
- Produces:
  - `src/lib/supabase.ts`: `supabase` singleton (`expo-secure-store` storage adapter, `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false`).
  - `src/lib/queryClient.ts`: `queryClient`, `asyncStoragePersister`, `QUERY_KEYS` factory (`rooms`, `roomDetail`, `roomMembers`, `roomBlocks`, `roomPollTallies`, `itemComments`, `activityLogs`).
  - `src/stores/authStore.ts`: `AVATAR_COLORS` preset array, `resolveAuthRedirect(state: { initialized: boolean; hasSession: boolean; hasProfile: boolean; pendingRoomCode: string | null; currentSegment: string | undefined }): string | null`, `useAuthStore`.
  - `src/stores/uiStore.ts`: `useUiStore` (`toast`, `showToast`, `dismissToast`).
  - `src/components/ui/*`: `Button`, `Card`, `Avatar`, `Badge`, `SheetModal` (BottomSheet wrapper using `@gorhom/bottom-sheet`).

- [ ] **Step 1: Write failing tests for auth + deep link redirect logic (pinning Review Focus #5)**

Create `tests/stores/authRedirect.test.ts`:
- `initialized: false` → returns `null` (wait for boot).
- Unauthenticated on `/(tabs)` → returns `"/(auth)/login"`.
- Authenticated without profile on `/(auth)/login` or `/(tabs)` → returns `"/(auth)/onboarding"`.
- Authenticated with profile and `pendingRoomCode: "K7M3P9"` on `/(auth)/onboarding` → returns `"/room/join?code=K7M3P9"` (Review Focus #5).
- Authenticated with profile and `pendingRoomCode: null` on `/(auth)/login` → returns `"/(tabs)"`.
- Authenticated with profile already on `/room/123` → returns `null`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/stores/authRedirect.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement Supabase client, query client, stores, and UI atoms**

- `src/lib/supabase.ts`: read `process.env.EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, wire `SecureStore.getItemAsync/setItemAsync/deleteItemAsync`.
- `src/lib/queryClient.ts`: TanStack `QueryClient` (`gcTime: 1000 * 60 * 60 * 24`, `staleTime: 1000 * 30`, `retry: 1`) + `createAsyncStoragePersister({ storage: AsyncStorage, key: 'POPROOM_QUERY_CACHE' })` + typed `QUERY_KEYS`.
- `src/stores/authStore.ts`: `resolveAuthRedirect` + Zustand state (`session`, `profile`, `initialized`, `pendingRoomCode`, `setPendingRoomCode`, `clearPendingRoomCode`, `refreshProfile`).
- `src/stores/uiStore.ts`: minimal toast banner queue (`info | success | error`).
- `src/components/ui/*`: clean NativeWind v4 tangerine-themed atomic components (`Button` variants `primary/secondary/ghost/danger`, `Card`, `Avatar` rendering colored circle + first char of nickname, `Badge`, `SheetModal` wrapping `BottomSheetModal` with backdrop and keyboard-aware scroll).

- [ ] **Step 4: Implement `app/_layout.tsx`, `app/(auth)/login.tsx`, and `app/(auth)/onboarding.tsx`**

- `app/_layout.tsx`: wrap app in `GestureHandlerRootView` → `PersistQueryClientProvider` → `BottomSheetModalProvider`; subscribe to `supabase.auth.onAuthStateChange` and `Linking.getInitialURL` / `Linking.addEventListener('url', ...)`; when an invite link arrives while unauthenticated, store `pendingRoomCode` via `extractRoomCodeFromUrl`; run `resolveAuthRedirect` in `useEffect` and clear `pendingRoomCode` immediately after navigating to `/room/join?code=...`; render global toast overlay.
- `app/(auth)/login.tsx`: clean Email + Password form with Sign In / Sign Up mode toggle (`supabase.auth.signInWithPassword` / `supabase.auth.signUp`), clear Chinese validation and error messages, branding header ("轻橘 PopRoom · 一件事一个房间").
- `app/(auth)/onboarding.tsx`: nickname input (trimmed 1–20 chars) + selectable `AVATAR_COLORS` swatch grid with live `Avatar` preview; upserts `profiles` and updates `authStore`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx.cmd vitest run tests/stores/authRedirect.test.ts` and `npx.cmd tsc --noEmit`
Expected: PASS, 0 TS errors.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/supabase.ts src/lib/queryClient.ts src/stores/ src/components/ui/ app/_layout.tsx app/\(auth\)/ tests/stores/authRedirect.test.ts
git commit -m "feat(auth): add Supabase client, offline query persister, UI atoms, login, onboarding, and DeepLink guard"
```

---

### Task 6: Activity Lobby, Template Room Creation, 6-Char Room Join & Host Settings

**Files:**
- Create: `src/api/rooms.ts`
- Create: `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx`, `app/(tabs)/profile.tsx`
- Create: `app/room/create.tsx`, `app/room/join.tsx`, `app/room/[id]/settings.tsx`
- Test: `tests/api/rooms.test.ts`

**Interfaces:**
- Consumes: `src/lib/supabase.ts`, `src/lib/queryClient.ts`, `src/lib/roomCode.ts`, `src/lib/templates.ts`, `src/hooks/useRoomPermissions.ts`, `src/stores/authStore.ts`, `src/components/ui/*`
- Produces:
  - `src/api/rooms.ts`: `RoomApiError`, `mapRoomError(err: unknown): string`, `validateCreateRoomInput(input)`, `prepareJoinPayload(rawCode: string, applyNote?: string)`, `fetchMyRooms(userId: string)`, `fetchRoomDetail(roomId: string)`, `fetchRoomMembers(roomId: string)`, `createRoomWithTemplate(input)`, `joinRoomByCode(rawCode: string, applyNote?: string)`, `reviewMemberApplication(...)`, `updateMemberRole(...)`, `kickRoomMember(...)`, `resetRoomCode(roomId: string)`, `updateRoomMetadata(...)`, `archiveRoom(roomId: string)`.
  - Complete M1 user-facing screens: Lobby, Profile, Create Room, Join Room (with realtime approval wait), Room Settings.

- [ ] **Step 1: Write failing tests for room API error mapping and input validation**

Create `tests/api/rooms.test.ts`:
- `mapRoomError` maps Postgres/Supabase error messages containing `ROOM_NOT_FOUND`, `ROOM_ARCHIVED`, `USER_KICKED`, `FORBIDDEN`, `INVALID_INPUT` to crisp Chinese user-facing messages.
- `validateCreateRoomInput` trims title, rejects empty title or title > 40 chars, validates `templateType` and `joinMode`.
- `prepareJoinPayload(" k7m-3p9 ", "  小明  ")` returns `{ p_room_code: "K7M3P9", p_apply_note: "小明" }`; throws `INVALID_ROOM_CODE` for `"000000"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/api/rooms.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/api/rooms.ts`**

Implement typed wrappers over Supabase queries and the 7 room/member RPCs from Task 2 (`create_room_with_template`, `join_room_by_code`, `review_member_application`, `update_member_role`, `kick_room_member`, `reset_room_code`, `archive_room`) plus `fetchMyRooms` separating `active` and `archived` rooms via `room_members` (`status = 'active'`) join.

- [ ] **Step 4: Implement Tab Layout, Lobby, Profile, Create Room, Join Room & Settings Screens**

- `app/(tabs)/_layout.tsx`: 2 bottom tabs (`活动` / `我的`), tangerine active tint `#F97316`.
- `app/(tabs)/index.tsx`: Lobby listing active room cards (title, template badge, member count, event dates), collapsible "已归档活动" section, header/floating buttons for "创建房间" (`router.push('/room/create')`) and "输码进房" (BottomSheet accepting 6-char room code and navigating to `/room/join?code=...` or calling `joinRoomByCode` directly).
- `app/(tabs)/profile.tsx`: Edit nickname & `avatar_color` (`profiles` update), archived activities count/quick view, Sign Out button (clears query cache + `supabase.auth.signOut()`).
- `app/room/create.tsx`: 4 template cards from `TEMPLATE_LIST`, room title, optional announcement, optional start/end dates, 2-tier gate radio (`凭码直进` vs `凭码申请审批`), submit via `createRoomWithTemplate` and `router.replace('/room/' + room.id)`.
- `app/room/join.tsx`: Reads optional `code` search param, displays 6-char uppercase input + optional `apply_note` input; on `status === 'active'` navigates to `/room/[id]`; on `status === 'pending'` renders realtime "等待房主审批" view subscribing to `room_members` row for `(room_id, user_id)` and auto-navigating into `/room/[id]` on approval or showing rejection notice with retry.
- `app/room/[id]/settings.tsx`: Room title/announcement/join_mode editor (admin/host), 6-char `room_code` card with "复制口令" (`buildShareMessage` + `expo-clipboard`) and "重置房间码" button, pending approval queue (approve/reject), active member list (host can promote/demote `admin`, admin/host can kick `member`), shortcut row to `/room/[id]/logs`, and host-only "归档活动（归档后全员只读）" button with destructive confirmation modal.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx.cmd vitest run tests/api/rooms.test.ts` and `npx.cmd tsc --noEmit`
Expected: PASS, 0 TS errors.

- [ ] **Step 6: Commit (Milestone 1 code complete)**

```powershell
git add src/api/rooms.ts app/\(tabs\)/ app/room/create.tsx app/room/join.tsx app/room/\[id\]/settings.tsx tests/api/rooms.test.ts
git commit -m "feat(rooms): implement lobby, profile, template creation, 6-char join flow, and host settings"
```

---

## Milestone 2: Four Collaboration Blocks, Real-Time Sync & Activity Logs

### Task 7: Room Collaboration Board Shell, Block Data Layer, Media Upload & Realtime Sync

**Files:**
- Create: `src/api/blocks.ts`
- Create: `src/lib/mediaUpload.ts`
- Create: `src/hooks/useRoomRealtime.ts`
- Create: `app/room/[id]/index.tsx`
- Test: `tests/api/blocks.test.ts`

**Interfaces:**
- Consumes: `src/lib/supabase.ts`, `src/lib/queryClient.ts`, `src/schemas/blocks.ts`, `src/hooks/useRoomPermissions.ts`, `src/api/rooms.ts`
- Produces:
  - `src/api/blocks.ts`: typed `ParsedBlock`, `ParsedBlockItem`, `parseBlockRowsSafely(blocks, items)`, `fetchRoomBlocksWithItems(roomId)`, `fetchRoomPollTallies(roomId)`, `togglePollVote(itemId)`, `toggleTaskClaim(itemId)`, `setTaskStatus(itemId, status)`, `updateTaskImages(itemId, imageUrls)`, `createBlock(...)`, `updateBlockConfig(...)`, `deleteBlock(...)`, `createBlockItem(...)`, `updateBlockItem(...)`, `softDeleteBlockItem(itemId)`, `restoreDeletedItem(logId)`, `fetchItemComments(itemId)`, `createItemComment(itemId, roomId, content)`, `fetchActivityLogs(roomId)`.
  - `src/lib/mediaUpload.ts`: `MAX_IMAGE_BYTES = 5 * 1024 * 1024`, `buildRoomMediaPath(roomId, blockType, itemId, ext)`, `extractMediaStoragePath(url: string): string | null`, `validateImageSizeBytes(bytes: number | undefined)`, `pickAndUploadRoomImage(params)`, `getSignedMediaUrl(canonicalOrPath: string)`.
  - `src/hooks/useRoomRealtime.ts`: `getInvalidationKeysForRealtimeEvent(roomId: string, table: string, itemId?: string)`, `useRoomRealtime(roomId: string, currentUserId: string | null)`.
  - `app/room/[id]/index.tsx`: Room Collaboration Board shell (placeholder dispatch ready for Tasks 8–10 blocks, wired cleanly as each block is added).

- [ ] **Step 1: Write failing tests for block parsing, media path/size validation, and realtime invalidation**

Create `tests/api/blocks.test.ts`:
- `buildRoomMediaPath("r1", "task", "i1", "jpg")` starts with `"r1/task/i1/"` and ends with `".jpg"`; `extractMediaStoragePath("https://demo.supabase.co/storage/v1/object/authenticated/room-media/r1/task/i1/a.jpg")` returns `"r1/task/i1/a.jpg"`.
- `validateImageSizeBytes(5 * 1024 * 1024)` passes; `validateImageSizeBytes(5 * 1024 * 1024 + 1)` throws `IMAGE_TOO_LARGE`.
- `getInvalidationKeysForRealtimeEvent("r1", "block_items")` returns BOTH `roomBlocks("r1")` AND `roomPollTallies("r1")` (critical because `toggle_poll_vote` signals via `block_items.updated_at`).
- `getInvalidationKeysForRealtimeEvent("r1", "rooms")` invalidates `roomDetail("r1")` and `rooms` list.
- `parseBlockRowsSafely` validates `config` / `data` via Zod and safely drops malformed items with a console warning instead of crashing the whole room.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/api/blocks.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `src/api/blocks.ts`, `src/lib/mediaUpload.ts`, and `src/hooks/useRoomRealtime.ts`**

- `src/api/blocks.ts`: all Supabase CRUD + RPC calls (`get_room_poll_tallies`, `toggle_poll_vote`, `toggle_task_claim`, `set_task_status`, `update_task_images`, `soft_delete_block_item`, `restore_deleted_item`), filtering `is_deleted = false` on reads and validating JSONB payloads through `src/schemas/blocks.ts` before writing and after reading.
- `src/lib/mediaUpload.ts`: `expo-image-picker` with `quality: 0.7`, verifies size `<= 5MB`, uploads to private bucket `room-media`, and returns the canonical authenticated object URL (`${supabaseUrl}/storage/v1/object/authenticated/room-media/${storagePath}`) so `imageUrls` / `receiptUrl` satisfy `z.string().url()`. When rendering `<Image>`, `getSignedMediaUrl` extracts `storagePath` via `extractMediaStoragePath` and creates a 1-hour signed URL.
- `src/hooks/useRoomRealtime.ts`: opens one Supabase channel `room:${roomId}` listening to `postgres_changes` on `rooms`, `room_members`, `blocks`, `block_items`, `item_comments` filtered by `room_id=eq.${roomId}` (and `id=eq.${roomId}` for `rooms`); invalidates QueryClient keys via `getInvalidationKeysForRealtimeEvent`; if current user's `room_members` row flips to `kicked`, shows toast and navigates back to `/(tabs)`.

- [ ] **Step 4: Implement `app/room/[id]/index.tsx`**

- Loads room detail, members, blocks+items, and poll tallies via TanStack Query; attaches `useRoomRealtime(id, currentUserId)`.
- Renders room header (title, 6-char code pill, Settings icon button, Export icon button), amber read-only banner when `room.status === 'archived'`, room announcement card, scrollable block cards list, and BottomSheet "添加积木" (visible per `useRoomPermissions`: host/admin can add any of the 4 block types; member can add `poll` if `allow_member_create_poll`).

- [ ] **Step 5: Run tests and typecheck**

Run: `npx.cmd vitest run tests/api/blocks.test.ts` and `npx.cmd tsc --noEmit`
Expected: PASS, 0 TS errors.

- [ ] **Step 6: Commit**

```powershell
git add src/api/blocks.ts src/lib/mediaUpload.ts src/hooks/useRoomRealtime.ts app/room/\[id\]/index.tsx tests/api/blocks.test.ts
git commit -m "feat(board): add room board shell, block API layer, room-media upload, and realtime sync"
```

---

### Task 8: Smart Poll Block (`PollBlock` — Option Voting & Availability Heatmap)

**Files:**
- Create: `src/lib/pollHelpers.ts`
- Create: `src/components/blocks/PollBlock.tsx`
- Modify: `app/room/[id]/index.tsx` (mount `PollBlock`)
- Test: `tests/lib/pollHelpers.test.ts`

**Interfaces:**
- Consumes: `src/schemas/blocks.ts`, `src/api/blocks.ts` (`togglePollVote`, `createBlockItem`, `updateBlockConfig`, `softDeleteBlockItem`), `src/hooks/useRoomPermissions.ts`, `src/components/ui/*`
- Produces:
  - `src/lib/pollHelpers.ts`: `applyOptimisticPollToggle(tallies: PollTally[], itemId: string, blockId: string, multiple: boolean, currentUserId: string, anonymous: boolean): PollTally[]`, `sanitizePollTallyForDisplay(tally: PollTally, anonymous: boolean): PollTally`, `AvailabilityCell`, `buildAvailabilityMatrix(dates: string[], slots: ('morning'|'afternoon'|'evening')[], items: ParsedBlockItem<'poll'>[], tallies: Map<string, PollTally>, totalActiveMembers: number): { cells: AvailabilityCell[]; maxVotes: number; topItemIds: string[] }`.
  - `src/components/blocks/PollBlock.tsx`: `<PollBlock block={...} items={...} tallies={...} members={...} permissions={...} />`.

- [ ] **Step 1: Write failing tests for poll helpers (pinning Review Focus #3)**

Create `tests/lib/pollHelpers.test.ts`:
- `applyOptimisticPollToggle` in single-choice (`multiple: false`) switches `my_voted` from item A to item B and decrements A / increments B; clicking already-voted item toggles it off.
- `applyOptimisticPollToggle` in multi-choice (`multiple: true`) keeps item A voted while adding item B.
- `sanitizePollTallyForDisplay` strips `voter_ids` to `[]` whenever `anonymous === true` (Review Focus #3), even if raw cache had IDs; preserves `voter_ids` when `anonymous === false`.
- `buildAvailabilityMatrix` calculates `ratio = voteCount / totalActiveMembers` (returns `0` safely when `totalActiveMembers === 0`), identifies `topItemIds` tied at `maxVotes > 0`, and returns empty `topItemIds` when zero votes exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/lib/pollHelpers.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/pollHelpers.ts` and `src/components/blocks/PollBlock.tsx`**

- `PollBlock.tsx`:
  - Renders `option` mode (horizontal vote progress bars, vote count & percentage, voter avatar stack hidden when `anonymous === true`, check highlight for `my_voted`, tap row to call optimistic `toggle_poll_vote` RPC with error toast & cache rollback on `ROOM_ARCHIVED`/`POLL_LOCKED`/`POLL_EXPIRED`).
  - Renders `availability` mode (clean compact grid: date rows × `上午 / 下午 / 晚上` columns; tangerine intensity tiers by `ratio`; badge on top-voted slots; single tap toggles vote via `toggle_poll_vote`).
  - BottomSheet for adding new option (when `allowAddOption` & room active), creating availability slots, and host/admin toggle for `isLocked` (锁定/解锁投票) and soft-deleting an option.
- Wire `PollBlock` into `app/room/[id]/index.tsx`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx.cmd vitest run tests/lib/pollHelpers.test.ts` and `npx.cmd tsc --noEmit`
Expected: PASS, 0 TS errors.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/pollHelpers.ts src/components/blocks/PollBlock.tsx app/room/\[id\]/index.tsx tests/lib/pollHelpers.test.ts
git commit -m "feat(poll): implement PollBlock with option voting, availability heatmap, and anonymous privacy"
```

---

### Task 9: Task & Supply Claim Block (`TaskBlock` — Claiming, Photos & Comments)

**Files:**
- Create: `src/lib/taskHelpers.ts`
- Create: `src/components/blocks/TaskBlock.tsx`
- Modify: `app/room/[id]/index.tsx` (mount `TaskBlock`)
- Test: `tests/lib/taskHelpers.test.ts`

**Interfaces:**
- Consumes: `src/schemas/blocks.ts`, `src/api/blocks.ts` (`toggleTaskClaim`, `setTaskStatus`, `updateTaskImages`, `createBlockItem`, `updateBlockItem`, `softDeleteBlockItem`, `fetchItemComments`, `createItemComment`), `src/lib/mediaUpload.ts`, `src/hooks/useRoomPermissions.ts`, `src/components/ui/*`
- Produces:
  - `src/lib/taskHelpers.ts`: `applyOptimisticTaskClaim(data: TaskItemData, userId: string): TaskItemData`, `applyOptimisticTaskStatus(data: TaskItemData, nextStatus: TaskItemData['status']): TaskItemData`, `appendTaskImageUrl(existing: string[], nextUrl: string): string[]`, `removeTaskImageUrl(existing: string[], targetUrl: string): string[]`.
  - `src/components/blocks/TaskBlock.tsx`: `<TaskBlock block={...} items={...} members={...} permissions={...} />`.

- [ ] **Step 1: Write failing tests for task helpers**

Create `tests/lib/taskHelpers.test.ts`:
- `applyOptimisticTaskClaim` on `unclaimed` task adds `userId` and sets `status: 'in_progress'`.
- Unclaiming when another assignee remains keeps `status: 'in_progress'`; unclaiming the last assignee reverts `in_progress` → `unclaimed` (but leaves `done` unchanged if already `done`).
- `appendTaskImageUrl` appends up to 3 URLs and throws `MAX_IMAGES_EXCEEDED` on a 4th URL; `removeTaskImageUrl` removes only the target URL.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/lib/taskHelpers.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/taskHelpers.ts` and `src/components/blocks/TaskBlock.tsx`**

- `TaskBlock.tsx`:
  - Displays completion summary badge (`已完成 X/Y`) and task cards showing status pill (`待认领` / `进行中` / `已完成`), assignee avatars, photo count & comment count indicators.
  - Card quick actions: one-tap "认领 / 取消认领" (optimistic `toggle_task_claim` RPC) and one-tap "完成 / 恢复进行中" (visible & enabled only when `permissions.canSetTaskStatus(item.created_by, data.assigneeIds)`).
  - Detail BottomSheet: full description, due time, up to 3 proof photos (rendered via signed URLs; add/remove gated by `permissions.canManageTaskImages` calling `pickAndUploadRoomImage` + `update_task_images`), live `item_comments` thread with single-line composer (when active), and Edit / Soft-Delete buttons (gated by `permissions.canEditOrDeleteItem`).
  - Create/Edit Task BottomSheet (title, description, optional due date).
- Wire `TaskBlock` into `app/room/[id]/index.tsx`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx.cmd vitest run tests/lib/taskHelpers.test.ts` and `npx.cmd tsc --noEmit`
Expected: PASS, 0 TS errors.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/taskHelpers.ts src/components/blocks/TaskBlock.tsx app/room/\[id\]/index.tsx tests/lib/taskHelpers.test.ts
git commit -m "feat(task): implement TaskBlock with atomic claiming, proof photos, and item comments"
```

---

### Task 10: Visual Schedule Timeline (`ScheduleBlock`) & Budget/AA Expense Block (`ExpenseBlock`)

**Files:**
- Create: `src/lib/scheduleHelpers.ts`
- Create: `src/components/blocks/ScheduleBlock.tsx`
- Create: `src/components/blocks/ExpenseBlock.tsx`
- Modify: `app/room/[id]/index.tsx` (mount `ScheduleBlock` and `ExpenseBlock`)
- Test: `tests/lib/scheduleHelpers.test.ts`

**Interfaces:**
- Consumes: `src/schemas/blocks.ts`, `src/lib/mapNavigation.ts`, `src/lib/splitAlgorithm.ts`, `src/lib/mediaUpload.ts`, `src/api/blocks.ts`, `src/hooks/useRoomPermissions.ts`, `src/components/ui/*`
- Produces:
  - `src/lib/scheduleHelpers.ts`: `ScheduleGroup { groupLabel: string; items: ParsedBlockItem<'schedule'>[] }`, `groupAndSortScheduleItems(items: ParsedBlockItem<'schedule'>[]): ScheduleGroup[]`.
  - `src/components/blocks/ScheduleBlock.tsx`: `<ScheduleBlock block={...} items={...} members={...} permissions={...} />`.
  - `src/components/blocks/ExpenseBlock.tsx`: `<ExpenseBlock block={...} items={...} members={...} permissions={...} />`.

- [ ] **Step 1: Write failing tests for schedule grouping and sorting**

Create `tests/lib/scheduleHelpers.test.ts`:
- Groups items by `groupLabel` preserving first-seen group order (defaulting empty label to `"活动当天"`).
- Sorts items within each group ascending by `startTime` (handling both `"09:00"`/`"14:30"` and ISO strings) with `sort_order` tie-breaker.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/lib/scheduleHelpers.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/scheduleHelpers.ts`, `ScheduleBlock.tsx`, and `ExpenseBlock.tsx`**

- `ScheduleBlock.tsx`:
  - Vertical timeline grouped by `groupAndSortScheduleItems`, showing `startTime`–`endTime`, title, owner avatar, notes, and plain-text `locationName` pill.
  - Tapping "导航" opens a BottomSheet listing `buildMapNavigationOptions(locationName, Platform.OS)` (checking `Linking.canOpenURL` and falling back to `fallbackUrl`) plus a "复制地点" button using `expo-clipboard`.
  - Create/Edit Schedule Item BottomSheet (`groupLabel`, `startTime`, `endTime`, `title`, plain-text `locationName`, `ownerId`, `notes`) + Soft-Delete action.
- `ExpenseBlock.tsx`:
  - Dual mode controlled by `ExpenseConfigSchema.mode`:
    - `budget`: summary card showing Total Budget / Spent / Remaining with progress bar (warning color if overspent) and host/admin budget edit shortcut.
    - `split`: summary card powered by `computeMinimalTransfers` showing each member's net balance (`+应收 / -应付`) and concise "最少转账结算方案" rows (`A 应向 B 转账 ¥XX.XX`).
  - Expense item list with payer avatar, participant count, amount (`formatCents`), date, receipt thumbnail preview (via `getSignedMediaUrl`), and Create/Edit Expense BottomSheet (title, amount in CNY, payer selector, multi-select participants defaulting to all active members, optional receipt photo upload via `pickAndUploadRoomImage`).
- Wire both blocks into `app/room/[id]/index.tsx`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx.cmd vitest run tests/lib/scheduleHelpers.test.ts` and `npx.cmd tsc --noEmit`
Expected: PASS, 0 TS errors.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/scheduleHelpers.ts src/components/blocks/ScheduleBlock.tsx src/components/blocks/ExpenseBlock.tsx app/room/\[id\]/index.tsx tests/lib/scheduleHelpers.test.ts
git commit -m "feat(blocks): implement ScheduleBlock with map navigation and ExpenseBlock with budget and AA split"
```

---

### Task 11: Activity Logs & One-Click Undo Rollback (`logs.tsx`)

**Files:**
- Create: `src/lib/activityLogHelpers.ts`
- Create: `app/room/[id]/logs.tsx`
- Test: `tests/lib/activityLogHelpers.test.ts`

**Interfaces:**
- Consumes: `src/types/database.ts` (`ActivityLogRow`), `src/api/blocks.ts` (`fetchActivityLogs`, `restoreDeletedItem`), `src/hooks/useRoomPermissions.ts`, `src/components/ui/*`
- Produces:
  - `src/lib/activityLogHelpers.ts`: `FormattedActivityLog { id: string; summary: string; detail: string; canRestore: boolean; isRestored: boolean; createdAt: string }`, `canRestoreLogEntry(log: ActivityLogRow, canUndoDelete: boolean): boolean`, `formatActivityLogEntry(log: ActivityLogRow, actorName: string, canUndoDelete: boolean): FormattedActivityLog`.
  - `app/room/[id]/logs.tsx`: Admin/host activity log screen with one-click restore.

- [ ] **Step 1: Write failing tests for activity log formatting & restore eligibility**

Create `tests/lib/activityLogHelpers.test.ts`:
- `action === 'delete_item'` with `restored_at === null` and `canUndoDelete === true` → `canRestore: true`, summary includes actor name and snapshot title/label.
- When `restored_at !== null` → `canRestore: false`, `isRestored: true`.
- When room is archived (`canUndoDelete === false`) → `canRestore: false`.
- Handles `kick_member`, `restore_item`, and `update_room` gracefully even when `before_snapshot` is partial or null.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/lib/activityLogHelpers.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/activityLogHelpers.ts` and `app/room/[id]/logs.tsx`**

- `app/room/[id]/logs.tsx`: fetches `activity_logs` and room members; gates screen with `permissions.canViewLogs` (friendly access notice if non-admin); displays chronological log cards with actor avatar, formatted summary, timestamp, "已恢复" badge, and "一键恢复" button calling `restoreDeletedItem(log.id)` + invalidating `roomBlocks`, `roomPollTallies`, and `activityLogs`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx.cmd vitest run tests/lib/activityLogHelpers.test.ts` and `npx.cmd tsc --noEmit`
Expected: PASS, 0 TS errors.

- [ ] **Step 5: Commit (Milestone 2 code complete)**

```powershell
git add src/lib/activityLogHelpers.ts app/room/\[id\]/logs.tsx tests/lib/activityLogHelpers.test.ts
git commit -m "feat(logs): implement activity logs view and host one-click undo for soft-deleted items"
```

---

## Milestone 3: Archive Read-Only Verification, Recap Export & Real-Device Acceptance

### Task 12: Recap Aggregator, Long-Image / PDF Export (`export.tsx`) & Stage 1 Acceptance Checklist

**Files:**
- Create: `src/lib/recapBuilder.ts`
- Create: `app/room/[id]/export.tsx`
- Create: `docs/superpowers/verification/stage1-device-checklist.md`
- Test: `tests/lib/recapBuilder.test.ts`

**Interfaces:**
- Consumes: `src/schemas/blocks.ts`, `src/lib/splitAlgorithm.ts`, `src/lib/scheduleHelpers.ts`, `src/api/rooms.ts`, `src/api/blocks.ts`, `src/hooks/useRoomPermissions.ts`, `src/components/ui/*`
- Produces:
  - `src/lib/recapBuilder.ts`: `RoomRecapData`, `buildRoomRecapData(input): RoomRecapData`, `escapeHtml(text: string): string`, `renderRecapHtml(recap: RoomRecapData): string`.
  - `app/room/[id]/export.tsx`: Live recap preview, HD PNG capture (`react-native-view-shot`), PDF export (`expo-print`), and system share sheet (`expo-sharing`).
  - `docs/superpowers/verification/stage1-device-checklist.md`: Dual-phone Expo Go acceptance guide.

- [ ] **Step 1: Write failing tests for recap aggregation, HTML escaping, and archived export (pinning Review Focus #4)**

Create `tests/lib/recapBuilder.test.ts`:
- `buildRoomRecapData` computes winning poll options (handling ties), task completion rate (`done / total`, returning `0` when 0 tasks), grouped schedule items, and budget/AA settlement summaries for both `active` and `archived` rooms.
- `renderRecapHtml` escapes `<script>`, `&`, `"`, `'` in room title, poll labels, task titles, and schedule locations while rendering structured sections for polls, tasks, schedule, and expenses.
- Verifies that an archived room's `RoomPermissions` still yields `canExportRecap === true` while blocking all writes (Review Focus #4).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/lib/recapBuilder.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/recapBuilder.ts`, `app/room/[id]/export.tsx`, and `docs/superpowers/verification/stage1-device-checklist.md`**

- `src/lib/recapBuilder.ts`: aggregates blocks, items, poll tallies, and member profiles into `RoomRecapData`; renders clean warm-tangerine styled A4 HTML string in `renderRecapHtml`.
- `app/room/[id]/export.tsx`:
  - Renders scrollable recap card wrapped in `<ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1 }}>` showing PopRoom header, event title/date/member count, poll conclusions, task completion bar & checklist, final schedule timeline, and budget/AA transfer summary.
  - Bottom action bar: "导出高清长图" (`viewShotRef.current.capture()` → `Sharing.shareAsync(uri, { mimeType: 'image/png' })`) and "导出 PDF" (`Print.printToFileAsync({ html: renderRecapHtml(recap) })` → `Sharing.shareAsync(uri, { mimeType: 'application/pdf' })`).
- `docs/superpowers/verification/stage1-device-checklist.md`: Step-by-step dual-phone Expo Go test protocol covering:
  1. M1: Email+Password sign-up (2 phones) → Onboarding → Template create → 6-char code join (both `passcode` & `approval` modes) → Deep link while logged out → Reset room code invalidates old code → Kick member.
  2. M2: Concurrent voting & heatmap sync → Anonymous poll payload check → Concurrent task claim + proof photo upload + item comment → Schedule keyword map navigation + airplane-mode offline read → AA split verification → Soft-delete & host one-click restore.
  3. M3: Host archives room while phone B is inside → Phone B immediately switches to read-only & rejects any write → Both phones export PNG long image & PDF cleanly.

- [ ] **Step 4: Run full test suite and strict TypeScript check**

Run: `npx.cmd vitest run` and `npx.cmd tsc --noEmit`
Expected: ALL test suites PASS; `tsc --noEmit` exits 0 with zero errors and zero `any`.

- [ ] **Step 5: Commit (Stage 1 MVP complete)**

```powershell
git add src/lib/recapBuilder.ts app/room/\[id\]/export.tsx docs/superpowers/verification/stage1-device-checklist.md tests/lib/recapBuilder.test.ts
git commit -m "feat(export): add activity recap builder, PNG/PDF export screen, and Stage 1 device checklist"
```
