-- 004_stage2_chat_and_compliance.sql
-- PopRoom Stage 2: Room chat, UGC compliance (reports & user blocks), read cursors,
-- extended activity_logs actions, RLS policies, and Realtime publication

-- ==========================================
-- 1. Room chat messages
-- ==========================================
CREATE TABLE IF NOT EXISTS public.room_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  msg_type TEXT NOT NULL DEFAULT 'text'
    CHECK (msg_type IN ('text', 'block_card', 'system')),
  content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_room_messages_room
  ON public.room_messages(room_id, created_at DESC)
  WHERE is_deleted = FALSE;

-- ==========================================
-- 2. UGC message reports (idempotent per reporter)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.message_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.room_messages(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reports_room
  ON public.message_reports(room_id, created_at DESC);

-- ==========================================
-- 3. User-level block list (bilateral chat hide via RLS + client filter)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker
  ON public.user_blocks(blocker_id);

-- ==========================================
-- 4. Per-room chat read cursors (for unread badge counts)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.room_chat_reads (
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

-- ==========================================
-- 5. Extend activity_logs action CHECK constraint
-- ==========================================
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  FOR v_constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'activity_logs'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%action%'
  LOOP
    EXECUTE format('ALTER TABLE public.activity_logs DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
  END LOOP;

  ALTER TABLE public.activity_logs
    ADD CONSTRAINT activity_logs_action_check
    CHECK (action IN (
      'delete_item',
      'restore_item',
      'update_room',
      'kick_member',
      'delete_message',
      'leave_room'
    ));
END;
$$;

-- ==========================================
-- 6. Unlock rooms.chat_enabled for Stage 2 room admins
-- Keeps template_type & created_by immutable and room_code/status/archived_at RPC-only.
-- Direct UPDATE remains gated by rooms_update_admin_active RLS (active room + host/admin).
-- ==========================================
CREATE OR REPLACE FUNCTION public.prevent_room_immutable_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_trusted_rpc BOOLEAN := COALESCE(current_setting('app.poproom_rpc', true), '') = '1';
BEGIN
  IF NEW.template_type IS DISTINCT FROM OLD.template_type
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF (
    NEW.room_code IS DISTINCT FROM OLD.room_code
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
  ) AND NOT v_is_trusted_rpc THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN NEW;
END;
$$;

-- ==========================================
-- 7. Enable Row Level Security on all 4 Stage 2 tables
-- ==========================================
ALTER TABLE public.room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_chat_reads ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 8. room_messages policies (SELECT only; all writes go through RPCs)
-- ==========================================
DROP POLICY IF EXISTS room_messages_select_active_member_unblocked ON public.room_messages;
CREATE POLICY room_messages_select_active_member_unblocked
  ON public.room_messages
  FOR SELECT
  USING (
    public.is_active_member(room_id)
    AND is_deleted = FALSE
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_blocks ub
      WHERE ub.blocker_id = auth.uid()
        AND ub.blocked_id = room_messages.sender_id
    )
  );

-- ==========================================
-- 9. message_reports policies (SELECT own reports only; writes via report_room_message RPC)
-- ==========================================
DROP POLICY IF EXISTS message_reports_select_own ON public.message_reports;
CREATE POLICY message_reports_select_own
  ON public.message_reports
  FOR SELECT
  USING (reporter_id = auth.uid());

-- ==========================================
-- 10. user_blocks policies (self-managed; allowed in active & archived rooms)
-- ==========================================
DROP POLICY IF EXISTS user_blocks_select_own ON public.user_blocks;
CREATE POLICY user_blocks_select_own
  ON public.user_blocks
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND blocker_id = auth.uid()
  );

DROP POLICY IF EXISTS user_blocks_insert_own ON public.user_blocks;
CREATE POLICY user_blocks_insert_own
  ON public.user_blocks
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND blocker_id = auth.uid()
    AND blocked_id <> auth.uid()
  );

DROP POLICY IF EXISTS user_blocks_delete_own ON public.user_blocks;
CREATE POLICY user_blocks_delete_own
  ON public.user_blocks
  FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND blocker_id = auth.uid()
  );

-- ==========================================
-- 11. room_chat_reads policies (self read cursor for active room members)
-- ==========================================
DROP POLICY IF EXISTS room_chat_reads_select_own ON public.room_chat_reads;
CREATE POLICY room_chat_reads_select_own
  ON public.room_chat_reads
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
    AND public.is_active_member(room_id)
  );

DROP POLICY IF EXISTS room_chat_reads_insert_own ON public.room_chat_reads;
CREATE POLICY room_chat_reads_insert_own
  ON public.room_chat_reads
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
    AND public.is_active_member(room_id)
  );

DROP POLICY IF EXISTS room_chat_reads_update_own ON public.room_chat_reads;
CREATE POLICY room_chat_reads_update_own
  ON public.room_chat_reads
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
    AND public.is_active_member(room_id)
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
    AND public.is_active_member(room_id)
  );

-- ==========================================
-- 12. Realtime publication
-- Adds room_messages while preserving Stage 1 anonymous poll exclusion.
-- ==========================================
ALTER TABLE public.room_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'room_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE room_messages;
  END IF;
END;
$$;
