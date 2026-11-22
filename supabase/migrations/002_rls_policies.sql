-- 002_rls_policies.sql
-- PopRoom Stage 1 MVP: Security helper functions, RLS policies, and private room-media storage

-- ==========================================
-- 1. SECURITY DEFINER helper functions
-- ==========================================
CREATE OR REPLACE FUNCTION public.is_active_member(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.room_members
    WHERE room_id = p_room_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_room_admin(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.room_members
    WHERE room_id = p_room_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND role IN ('host', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_room_host(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.room_members
    WHERE room_id = p_room_id
      AND user_id = auth.uid()
      AND status = 'active'
      AND role = 'host'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_room_active(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rooms
    WHERE id = p_room_id
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_poll_anonymous(p_block_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN jsonb_typeof(config->'anonymous') = 'boolean'
          THEN (config->>'anonymous')::boolean
        ELSE FALSE
      END
      FROM public.blocks
      WHERE id = p_block_id
        AND type = 'poll'
    ),
    FALSE
  );
$$;

-- ==========================================
-- 2. Enable Row Level Security on all 8 tables
-- ==========================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.block_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- 3. profiles policies
-- ==========================================
CREATE POLICY profiles_select_self_or_comember
  ON public.profiles
  FOR SELECT
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.room_members rm_target
      JOIN public.room_members rm_viewer
        ON rm_viewer.room_id = rm_target.room_id
      WHERE rm_target.user_id = profiles.id
        AND rm_viewer.user_id = auth.uid()
        AND rm_viewer.status = 'active'
        AND (
          rm_target.status = 'active'
          OR (
            rm_target.status = 'pending'
            AND rm_viewer.role IN ('host', 'admin')
          )
        )
    )
  );

CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND id = auth.uid()
  );

CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND id = auth.uid()
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND id = auth.uid()
  );

-- ==========================================
-- 4. rooms policies (creation & archival go through RPCs)
-- ==========================================
CREATE POLICY rooms_select_active_member
  ON public.rooms
  FOR SELECT
  USING (public.is_active_member(id));

CREATE POLICY rooms_update_admin_active
  ON public.rooms
  FOR UPDATE
  USING (
    public.is_room_active(id)
    AND public.is_room_admin(id)
  )
  WITH CHECK (
    public.is_room_active(id)
    AND public.is_room_admin(id)
    AND status = 'active'
  );

-- ==========================================
-- 5. room_members policies (all mutations go through RPCs)
-- ==========================================
CREATE POLICY room_members_select_self_or_active_member
  ON public.room_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_active_member(room_id)
  );

-- ==========================================
-- 6. blocks policies
-- ==========================================
CREATE POLICY blocks_select_active_member
  ON public.blocks
  FOR SELECT
  USING (public.is_active_member(room_id));

CREATE POLICY blocks_insert_authorized
  ON public.blocks
  FOR INSERT
  WITH CHECK (
    public.is_room_active(room_id)
    AND (
      public.is_room_admin(room_id)
      OR (
        public.is_active_member(room_id)
        AND type = 'poll'
        AND EXISTS (
          SELECT 1
          FROM public.rooms r
          WHERE r.id = room_id
            AND r.status = 'active'
            AND r.allow_member_create_poll = TRUE
        )
      )
    )
  );

CREATE POLICY blocks_update_admin
  ON public.blocks
  FOR UPDATE
  USING (
    public.is_room_active(room_id)
    AND public.is_room_admin(room_id)
  )
  WITH CHECK (
    public.is_room_active(room_id)
    AND public.is_room_admin(room_id)
  );

CREATE POLICY blocks_delete_admin
  ON public.blocks
  FOR DELETE
  USING (
    public.is_room_active(room_id)
    AND public.is_room_admin(room_id)
  );

-- ==========================================
-- 7. block_items policies
-- Direct DELETE is intentionally omitted; use soft_delete_block_item RPC.
-- ==========================================
CREATE POLICY block_items_select_active_member
  ON public.block_items
  FOR SELECT
  USING (public.is_active_member(room_id));

CREATE POLICY block_items_insert_active_member
  ON public.block_items
  FOR INSERT
  WITH CHECK (
    public.is_room_active(room_id)
    AND public.is_active_member(room_id)
    AND (created_by IS NULL OR created_by = auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.blocks b
      WHERE b.id = block_id
        AND b.room_id = block_items.room_id
        AND (
          public.is_room_admin(block_items.room_id)
          OR b.type IN ('schedule', 'expense')
          OR (
            b.type = 'task'
            AND CASE
              WHEN jsonb_typeof(b.config->'allowMemberCreate') = 'boolean'
                THEN (b.config->>'allowMemberCreate')::boolean
              ELSE TRUE
            END
          )
          OR (
            b.type = 'poll'
            AND CASE
              WHEN jsonb_typeof(b.config->'allowAddOption') = 'boolean'
                THEN (b.config->>'allowAddOption')::boolean
              ELSE TRUE
            END
            AND NOT CASE
              WHEN jsonb_typeof(b.config->'isLocked') = 'boolean'
                THEN (b.config->>'isLocked')::boolean
              ELSE FALSE
            END
          )
        )
    )
  );

CREATE POLICY block_items_update_creator_or_admin
  ON public.block_items
  FOR UPDATE
  USING (
    public.is_room_active(room_id)
    AND (created_by = auth.uid() OR public.is_room_admin(room_id))
  )
  WITH CHECK (
    public.is_room_active(room_id)
    AND (created_by = auth.uid() OR public.is_room_admin(room_id))
  );

-- ==========================================
-- 8. poll_votes policies (read-only guard; all writes via toggle_poll_vote RPC)
-- ==========================================
CREATE POLICY poll_votes_select_non_anonymous_or_own
  ON public.poll_votes
  FOR SELECT
  USING (
    public.is_active_member(room_id)
    AND (
      user_id = auth.uid()
      OR NOT public.is_poll_anonymous(block_id)
    )
  );

-- ==========================================
-- 9. item_comments policies
-- ==========================================
CREATE POLICY item_comments_select_active_member
  ON public.item_comments
  FOR SELECT
  USING (public.is_active_member(room_id));

CREATE POLICY item_comments_insert_active_member
  ON public.item_comments
  FOR INSERT
  WITH CHECK (
    public.is_room_active(room_id)
    AND public.is_active_member(room_id)
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.block_items bi
      WHERE bi.id = item_id
        AND bi.room_id = item_comments.room_id
        AND bi.is_deleted = FALSE
    )
  );

CREATE POLICY item_comments_delete_author_or_admin
  ON public.item_comments
  FOR DELETE
  USING (
    public.is_room_active(room_id)
    AND (user_id = auth.uid() OR public.is_room_admin(room_id))
  );

-- ==========================================
-- 10. activity_logs policies (admin-only read; all writes via RPCs)
-- ==========================================
CREATE POLICY activity_logs_select_admin
  ON public.activity_logs
  FOR SELECT
  USING (public.is_room_admin(room_id));

-- ==========================================
-- 11. Private storage bucket 'room-media' & RLS policies
-- Path convention: {room_id}/{block_type}/{item_id}/{uuid}.{ext}
-- ==========================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('room-media', 'room-media', FALSE, 5242880)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS room_media_select_member ON storage.objects;
CREATE POLICY room_media_select_member
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'room-media'
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN public.is_active_member((storage.foldername(name))[1]::uuid)
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS room_media_insert_active_member ON storage.objects;
CREATE POLICY room_media_insert_active_member
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'room-media'
    AND auth.uid() IS NOT NULL
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (
          public.is_room_active((storage.foldername(name))[1]::uuid)
          AND public.is_active_member((storage.foldername(name))[1]::uuid)
        )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS room_media_update_owner_or_admin ON storage.objects;
CREATE POLICY room_media_update_owner_or_admin
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'room-media'
    AND auth.uid() IS NOT NULL
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (
          public.is_room_active((storage.foldername(name))[1]::uuid)
          AND public.is_active_member((storage.foldername(name))[1]::uuid)
          AND (
            owner = auth.uid()
            OR public.is_room_admin((storage.foldername(name))[1]::uuid)
          )
        )
      ELSE FALSE
    END
  );

DROP POLICY IF EXISTS room_media_delete_owner_or_admin ON storage.objects;
CREATE POLICY room_media_delete_owner_or_admin
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'room-media'
    AND auth.uid() IS NOT NULL
    AND CASE
      WHEN (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (
          public.is_room_active((storage.foldername(name))[1]::uuid)
          AND public.is_active_member((storage.foldername(name))[1]::uuid)
          AND (
            owner = auth.uid()
            OR public.is_room_admin((storage.foldername(name))[1]::uuid)
          )
        )
      ELSE FALSE
    END
  );
