-- 001_initial_schema.sql
-- PopRoom Stage 1 MVP: Core tables, constraints, indexes, and Realtime publication

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Shared trigger helper to keep updated_at current on row modifications
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ==========================================
-- 1. User profiles (bound 1:1 to auth.users)
-- ==========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL CHECK (char_length(btrim(nickname)) BETWEEN 1 AND 20),
  avatar_color TEXT NOT NULL DEFAULT '#F97316',
  avatar_url TEXT,
  expo_push_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================
-- 2. Collaboration rooms
-- ==========================================
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) > 0),
  announcement TEXT NOT NULL DEFAULT '',
  template_type TEXT NOT NULL DEFAULT 'custom'
    CHECK (template_type IN ('campus', 'travel', 'party', 'custom')),
  event_start_at TIMESTAMPTZ,
  event_end_at TIMESTAMPTZ,
  join_mode TEXT NOT NULL DEFAULT 'passcode'
    CHECK (join_mode IN ('passcode', 'approval')),
  room_code TEXT UNIQUE NOT NULL
    CHECK (room_code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$'),
  chat_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  allow_member_create_poll BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  archived_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_rooms_updated_at
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================
-- 3. Room members and gatekeeping status
-- ==========================================
CREATE TABLE public.room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('host', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'rejected', 'kicked')),
  apply_note TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, user_id)
);

CREATE INDEX idx_room_members_user ON public.room_members(user_id, status);
CREATE INDEX idx_room_members_room ON public.room_members(room_id, status);

-- ==========================================
-- 4. Collaboration blocks
-- ==========================================
CREATE TABLE public.blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('poll', 'task', 'schedule', 'expense')),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) > 0),
  sort_order INT NOT NULL DEFAULT 0,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blocks_room ON public.blocks(room_id, sort_order);

CREATE TRIGGER trg_blocks_updated_at
  BEFORE UPDATE ON public.blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================
-- 5. Block items (poll options / tasks / schedule items / expenses)
-- ==========================================
CREATE TABLE public.block_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id UUID NOT NULL REFERENCES public.blocks(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_block_items_room ON public.block_items(room_id, block_id) WHERE is_deleted = FALSE;

CREATE TRIGGER trg_block_items_updated_at
  BEFORE UPDATE ON public.block_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ==========================================
-- 6. Dedicated poll votes table (concurrency-safe & anonymous-safe)
-- ==========================================
CREATE TABLE public.poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  block_id UUID NOT NULL REFERENCES public.blocks(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.block_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, user_id)
);

CREATE INDEX idx_poll_votes_room_block ON public.poll_votes(room_id, block_id);
CREATE INDEX idx_poll_votes_block_user ON public.poll_votes(block_id, user_id);

-- ==========================================
-- 7. Lightweight item-level comments
-- ==========================================
CREATE TABLE public.item_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.block_items(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(btrim(content)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_item_comments_item ON public.item_comments(item_id, created_at);

-- ==========================================
-- 8. Activity logs (audit trail & soft-delete undo snapshots)
-- ==========================================
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('delete_item', 'restore_item', 'update_room', 'kick_member')),
  target_table TEXT NOT NULL,
  target_id UUID NOT NULL,
  before_snapshot JSONB,
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_room ON public.activity_logs(room_id, created_at DESC);

-- ==========================================
-- 9. Realtime publication
-- Intentionally excludes poll_votes so anonymous voter identities never leak over Realtime.
-- ==========================================
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_members REPLICA IDENTITY FULL;
ALTER TABLE public.blocks REPLICA IDENTITY FULL;
ALTER TABLE public.block_items REPLICA IDENTITY FULL;
ALTER TABLE public.item_comments REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE
  rooms,
  room_members,
  blocks,
  block_items,
  item_comments;
