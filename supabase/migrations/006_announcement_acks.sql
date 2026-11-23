-- 006_announcement_acks.sql
-- PopRoom Stage 2 Enhancement: Announcement Read/Ack Confirmation Tracking
-- Tracks per-member confirmation of the latest room announcement version.

-- ==========================================
-- 1. Track announcement version timestamp on rooms
-- ==========================================
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS announcement_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.touch_room_announcement_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.announcement IS DISTINCT FROM OLD.announcement THEN
    NEW.announcement_updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rooms_announcement_updated_at ON public.rooms;
CREATE TRIGGER trg_rooms_announcement_updated_at
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_room_announcement_updated_at();

-- ==========================================
-- 2. Announcement acknowledgements table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.room_announcement_acks (
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  announcement_version TIMESTAMPTZ NOT NULL,
  acked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_room_announcement_acks_room
  ON public.room_announcement_acks(room_id, announcement_version);

-- ==========================================
-- 3. Row Level Security (SELECT for active members; writes RPC-only)
-- ==========================================
ALTER TABLE public.room_announcement_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS room_announcement_acks_select_member ON public.room_announcement_acks;
CREATE POLICY room_announcement_acks_select_member
  ON public.room_announcement_acks
  FOR SELECT
  USING (public.is_active_member(room_id));

-- ==========================================
-- 4. Realtime publication (keeps poll_votes excluded)
-- ==========================================
ALTER TABLE public.room_announcement_acks REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'room_announcement_acks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_announcement_acks;
  END IF;
END;
$$;

-- ==========================================
-- 5. Atomic RPC: acknowledge_room_announcement
-- ==========================================
CREATE OR REPLACE FUNCTION public.acknowledge_room_announcement(
  p_room_id UUID
)
RETURNS public.room_announcement_acks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_ack public.room_announcement_acks%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT *
  INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF NOT public.is_active_member(p_room_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF v_room.status <> 'active' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF char_length(btrim(COALESCE(v_room.announcement, ''))) = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  INSERT INTO public.room_announcement_acks (
    room_id,
    user_id,
    announcement_version,
    acked_at
  )
  VALUES (
    p_room_id,
    v_user_id,
    v_room.announcement_updated_at,
    NOW()
  )
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET
    announcement_version = EXCLUDED.announcement_version,
    acked_at = EXCLUDED.acked_at
  RETURNING * INTO v_ack;

  RETURN v_ack;
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_room_announcement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acknowledge_room_announcement(UUID) TO authenticated, service_role;

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';
