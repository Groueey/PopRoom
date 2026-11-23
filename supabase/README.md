# PopRoom Supabase Setup Guide (Stage 1 + Stage 2)

English | [简体中文](./README.zh.md)

Follow these steps to initialize (or upgrade) the PostgreSQL schema, Row Level Security (RLS) policies, private `room-media` storage bucket, Realtime publication, atomic RPCs, and 7-day `pg_cron` auto-archival in your Supabase project.

## 1. Create a Supabase Project

1. Sign in to [Supabase](https://supabase.com/dashboard) and click **New Project**.
2. Choose your organization, project name (e.g., `poproom-mvp`), strong database password, and nearest region.
3. Wait for the database provisioning to complete.

## 2. Enable `pg_cron` Extension (Before Running `005`)

Stage 2 includes an automatic 7-day room archival job (`poproom-auto-archive-daily`) scheduled at `0 19 * * *` UTC (03:00 Asia/Shanghai). To register it automatically when running `005`:

1. In the Supabase dashboard, open **Database** → **Extensions**.
2. Search for **`pg_cron`** and toggle it **ON**.
3. Wait for the extension to finish enabling before executing `005_stage2_rpcs_and_auto_archive.sql`.

> Note: `005_stage2_rpcs_and_auto_archive.sql` checks for `pg_cron` safely and unschedules any prior `poproom-auto-archive-daily` job first. If you enable `pg_cron` later, you can safely re-run `005` in **SQL Editor** to register the daily schedule.

## 3. Run Migrations in Sequential Order (`001` → `002` → `003` → `004` → `005`)

Open **SQL Editor** in your Supabase project dashboard and execute the migration scripts strictly in order (existing Stage 1 projects only need to run `004` and `005`):

1. `supabase/migrations/001_initial_schema.sql`
   - Creates the 8 Stage 1 tables (`profiles`, `rooms`, `room_members`, `blocks`, `block_items`, `poll_votes`, `item_comments`, `activity_logs`), indexes, triggers, and enables Realtime on `rooms`, `room_members`, `blocks`, `block_items`, and `item_comments` (intentionally excluding `poll_votes` to protect anonymous polls).
2. `supabase/migrations/002_rls_policies.sql`
   - Creates the 5 `SECURITY DEFINER` helper functions (`SET search_path = public`), enables RLS on all 8 tables, enforces archive read-only locks via `is_room_active`, restricts direct updates/deletes, and creates the private `room-media` storage bucket with room-scoped `storage.objects` policies.
3. `supabase/migrations/003_rpcs.sql`
   - Creates `generate_unique_room_code()` and the 14 Stage 1 atomic `SECURITY DEFINER` RPCs for room creation, 6-char room code entry/approval, anonymous-safe poll voting & tallies, task claiming/status/image updates, soft-delete/restore, and room archiving.
4. `supabase/migrations/004_stage2_chat_and_compliance.sql`
   - Creates the 4 Stage 2 tables (`room_messages`, `message_reports`, `user_blocks`, `room_chat_reads`), extends `activity_logs` actions with `'delete_message'` and `'leave_room'`, unlocks `rooms.chat_enabled` updates for active room admins, configures RLS (filtering deleted messages and blocked senders at the DB layer with RPC-only write boundaries), and adds `room_messages` to `supabase_realtime` while keeping `poll_votes` excluded.
5. `supabase/migrations/005_stage2_rpcs_and_auto_archive.sql`
   - Drops the 6-argument `create_room_with_template` overload and upgrades it with optional `p_chat_enabled` (defaulting `TRUE` for `campus`/`travel`, `FALSE` for `party`/`custom`), creates `send_room_message`, `soft_delete_room_message`, `report_room_message`, `reorder_room_blocks`, `leave_room`, and `auto_archive_expired_rooms()` (`service_role` only), and registers the idempotent `pg_cron` daily job `poproom-auto-archive-daily` when `pg_cron` is enabled.
6. `supabase/migrations/006_announcement_acks.sql`
   - Adds `rooms.announcement_updated_at` and an auto-bump trigger on announcement edits; creates `room_announcement_acks` with member-read RLS, Realtime publication, and the `acknowledge_room_announcement(p_room_id)` RPC so hosts can track who confirmed reading the latest announcement.

> Tip: Copy each file's full contents into a fresh query tab in **SQL Editor** and click **Run** before proceeding to the next file.

## 4. Disable "Confirm Email" for Expo Go MVP Auth

Because Supabase free-tier default SMTP is rate-limited (~2 emails/hour), PopRoom uses Email + Password login without mandatory email verification:

1. In the Supabase dashboard, go to **Authentication** → **Providers** → **Email**.
2. Toggle **Confirm Email** to **OFF** (disabled).
3. Click **Save**.

## 5. Configure Local `.env`

1. In the Supabase dashboard, open **Project Settings** → **API** (or **Data API** / **API Keys**).
2. Copy `.env.example` to `.env` in the repository root and fill in your project values:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

3. Restart Expo (`npx.cmd expo start -c`) whenever `.env` changes.
