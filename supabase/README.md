# PopRoom Supabase Setup Guide (Stage 1 MVP)

Follow these steps to initialize the PostgreSQL schema, Row Level Security (RLS) policies, private `room-media` storage bucket, Realtime publication, and atomic RPCs in a new Supabase project.

## 1. Create a Supabase Project

1. Sign in to [Supabase](https://supabase.com/dashboard) and click **New Project**.
2. Choose your organization, project name (e.g., `poproom-mvp`), strong database password, and nearest region.
3. Wait for the database provisioning to complete.

## 2. Run Migrations in Sequential Order (`001` → `002` → `003`)

Open **SQL Editor** in your Supabase project dashboard and execute the migration scripts strictly in order:

1. `supabase/migrations/001_initial_schema.sql`
   - Creates the 8 tables (`profiles`, `rooms`, `room_members`, `blocks`, `block_items`, `poll_votes`, `item_comments`, `activity_logs`), indexes, triggers, and enables Realtime on `rooms`, `room_members`, `blocks`, `block_items`, and `item_comments` (intentionally excluding `poll_votes` to protect anonymous polls).
2. `supabase/migrations/002_rls_policies.sql`
   - Creates the 5 `SECURITY DEFINER` helper functions (`SET search_path = public`), enables RLS on all 8 tables, enforces archive read-only locks via `is_room_active`, restricts direct updates/deletes, and creates the private `room-media` storage bucket with room-scoped `storage.objects` policies.
3. `supabase/migrations/003_rpcs.sql`
   - Creates `generate_unique_room_code()` and the 14 atomic `SECURITY DEFINER` RPCs for room creation, 6-char room code entry/approval, anonymous-safe poll voting & tallies, task claiming/status/image updates, soft-delete/restore, and room archiving.

> Tip: Copy each file's full contents into a fresh query tab in **SQL Editor** and click **Run** before proceeding to the next file.

## 3. Disable "Confirm Email" for Stage 1 MVP Auth

Because Supabase free-tier default SMTP is rate-limited (~2 emails/hour), Stage 1 MVP uses Email + Password login without mandatory email verification:

1. In the Supabase dashboard, go to **Authentication** → **Providers** → **Email**.
2. Toggle **Confirm Email** to **OFF** (disabled).
3. Click **Save**.

## 4. Configure Local `.env`

1. In the Supabase dashboard, open **Project Settings** → **API** (or **Data API** / **API Keys**).
2. Copy `.env.example` to `.env` in the repository root and fill in your project values:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

3. Restart Expo (`npx.cmd expo start -c`) whenever `.env` changes.
