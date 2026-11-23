-- 005_stage2_rpcs_and_auto_archive.sql
-- PopRoom Stage 2: Upgraded create_room_with_template (7-arg), chat/compliance/reorder/leave RPCs,
-- 7-day auto-archival function, and guarded idempotent pg_cron schedule

-- ==========================================
-- 1. create_room_with_template (Stage 2 upgrade: adds p_chat_enabled)
-- Explicitly drop the Stage 1 6-arg overload to prevent PostgREST RPC overload ambiguity.
-- ==========================================
DROP FUNCTION IF EXISTS public.create_room_with_template(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.create_room_with_template(
  p_title TEXT,
  p_template_type TEXT,
  p_join_mode TEXT,
  p_announcement TEXT DEFAULT '',
  p_event_start_at TIMESTAMPTZ DEFAULT NULL,
  p_event_end_at TIMESTAMPTZ DEFAULT NULL,
  p_chat_enabled BOOLEAN DEFAULT NULL
)
RETURNS public.rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_title TEXT;
  v_announcement TEXT;
  v_room_code TEXT;
  v_chat_enabled BOOLEAN;
  v_room public.rooms%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'PROFILE_REQUIRED';
  END IF;

  v_title := btrim(COALESCE(p_title, ''));
  IF v_title = '' OR char_length(v_title) > 40 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  IF p_template_type IS NULL OR p_template_type NOT IN ('campus', 'travel', 'party', 'custom') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  IF p_join_mode IS NULL OR p_join_mode NOT IN ('passcode', 'approval') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  IF p_event_start_at IS NOT NULL
     AND p_event_end_at IS NOT NULL
     AND p_event_end_at < p_event_start_at THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  v_announcement := COALESCE(p_announcement, '');
  v_room_code := public.generate_unique_room_code();
  v_chat_enabled := COALESCE(p_chat_enabled, p_template_type IN ('campus', 'travel'));

  INSERT INTO public.rooms (
    title,
    announcement,
    template_type,
    event_start_at,
    event_end_at,
    join_mode,
    room_code,
    chat_enabled,
    allow_member_create_poll,
    status,
    created_by
  )
  VALUES (
    v_title,
    v_announcement,
    p_template_type,
    p_event_start_at,
    p_event_end_at,
    p_join_mode,
    v_room_code,
    v_chat_enabled,
    TRUE,
    'active',
    v_user_id
  )
  RETURNING * INTO v_room;

  INSERT INTO public.room_members (room_id, user_id, role, status)
  VALUES (v_room.id, v_user_id, 'host', 'active');

  IF p_template_type = 'campus' THEN
    INSERT INTO public.blocks (room_id, type, title, sort_order, config, created_by)
    VALUES
      (
        v_room.id,
        'poll',
        '时间投票',
        0,
        '{"mode":"availability","multiple":true,"anonymous":false,"allowAddOption":true,"deadline":null,"isLocked":false,"candidateDates":[],"timeSlots":["morning","afternoon","evening"]}'::jsonb,
        v_user_id
      ),
      (
        v_room.id,
        'task',
        '分工与物资认领',
        1,
        '{"allowMemberCreate":true}'::jsonb,
        v_user_id
      ),
      (
        v_room.id,
        'schedule',
        '活动当天日程轴',
        2,
        '{"groupBy":"day"}'::jsonb,
        v_user_id
      ),
      (
        v_room.id,
        'expense',
        '社团预算报销',
        3,
        '{"mode":"budget","totalBudget":null,"currency":"CNY"}'::jsonb,
        v_user_id
      );
  ELSIF p_template_type = 'travel' THEN
    INSERT INTO public.blocks (room_id, type, title, sort_order, config, created_by)
    VALUES
      (
        v_room.id,
        'poll',
        '方案/目的地投票',
        0,
        '{"mode":"option","multiple":false,"anonymous":false,"allowAddOption":true,"deadline":null,"isLocked":false}'::jsonb,
        v_user_id
      ),
      (
        v_room.id,
        'schedule',
        '每日行程轴',
        1,
        '{"groupBy":"day"}'::jsonb,
        v_user_id
      ),
      (
        v_room.id,
        'task',
        '行李物资分工',
        2,
        '{"allowMemberCreate":true}'::jsonb,
        v_user_id
      ),
      (
        v_room.id,
        'expense',
        'AA 分账器',
        3,
        '{"mode":"split","totalBudget":null,"currency":"CNY"}'::jsonb,
        v_user_id
      );
  ELSIF p_template_type = 'party' THEN
    INSERT INTO public.blocks (room_id, type, title, sort_order, config, created_by)
    VALUES
      (
        v_room.id,
        'poll',
        '时间与餐厅投票',
        0,
        '{"mode":"option","multiple":false,"anonymous":false,"allowAddOption":true,"deadline":null,"isLocked":false}'::jsonb,
        v_user_id
      ),
      (
        v_room.id,
        'expense',
        '费用 AA 分账',
        1,
        '{"mode":"split","totalBudget":null,"currency":"CNY"}'::jsonb,
        v_user_id
      );
  ELSIF p_template_type = 'custom' THEN
    NULL;
  END IF;

  RETURN v_room;
END;
$$;

-- ==========================================
-- 2. send_room_message
-- ==========================================
CREATE OR REPLACE FUNCTION public.send_room_message(
  p_room_id UUID,
  p_msg_type TEXT,
  p_content TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.room_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_content TEXT;
  v_metadata JSONB;
  v_linked_block_raw TEXT;
  v_linked_block_id UUID;
  v_mention_all BOOLEAN;
  v_msg public.room_messages%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF NOT public.is_active_member(p_room_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF v_room.status = 'archived' OR NOT public.is_room_active(p_room_id) THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF v_room.chat_enabled IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'CHAT_DISABLED';
  END IF;

  IF p_msg_type IS NULL OR p_msg_type NOT IN ('text', 'block_card') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  v_content := btrim(COALESCE(p_content, ''));
  IF char_length(v_content) < 1 OR char_length(v_content) > 1000 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  v_metadata := COALESCE(p_metadata, '{}'::jsonb);
  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  IF p_msg_type = 'block_card' THEN
    IF NOT public.is_room_admin(p_room_id) THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;

    v_linked_block_raw := NULLIF(btrim(COALESCE(v_metadata->>'linkedBlockId', '')), '');
    IF v_linked_block_raw IS NULL
       OR v_linked_block_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;

    v_linked_block_id := v_linked_block_raw::uuid;
    IF NOT EXISTS (
      SELECT 1
      FROM public.blocks
      WHERE id = v_linked_block_id
        AND room_id = p_room_id
    ) THEN
      RAISE EXCEPTION 'ITEM_NOT_FOUND';
    END IF;
  END IF;

  IF v_metadata ? 'mentionAll'
     AND jsonb_typeof(v_metadata->'mentionAll') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  v_mention_all := CASE
    WHEN jsonb_typeof(v_metadata->'mentionAll') = 'boolean'
      THEN COALESCE((v_metadata->>'mentionAll')::boolean, FALSE)
    ELSE FALSE
  END;

  IF v_mention_all AND NOT public.is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  INSERT INTO public.room_messages (
    room_id,
    sender_id,
    msg_type,
    content,
    metadata
  )
  VALUES (
    p_room_id,
    v_user_id,
    p_msg_type,
    v_content,
    v_metadata
  )
  RETURNING * INTO v_msg;

  INSERT INTO public.room_chat_reads (room_id, user_id, last_read_at)
  VALUES (p_room_id, v_user_id, NOW())
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET last_read_at = GREATEST(public.room_chat_reads.last_read_at, NOW());

  RETURN v_msg;
END;
$$;

-- ==========================================
-- 3. soft_delete_room_message
-- ==========================================
CREATE OR REPLACE FUNCTION public.soft_delete_room_message(
  p_message_id UUID
)
RETURNS public.room_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_msg public.room_messages%ROWTYPE;
  v_updated_msg public.room_messages%ROWTYPE;
  v_room public.rooms%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_msg
  FROM public.room_messages
  WHERE id = p_message_id
    AND is_deleted = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_msg.room_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' OR NOT public.is_room_active(v_msg.room_id) THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_active_member(v_msg.room_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF NOT (v_msg.sender_id = v_user_id OR public.is_room_admin(v_msg.room_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.room_messages
  SET is_deleted = TRUE
  WHERE id = p_message_id
  RETURNING * INTO v_updated_msg;

  INSERT INTO public.activity_logs (
    room_id,
    actor_id,
    action,
    target_table,
    target_id,
    before_snapshot
  )
  VALUES (
    v_msg.room_id,
    v_user_id,
    'delete_message',
    'room_messages',
    p_message_id,
    to_jsonb(v_msg)
  );

  RETURN v_updated_msg;
END;
$$;

-- ==========================================
-- 4. report_room_message
-- Intentionally permitted in archived rooms for UGC compliance.
-- ==========================================
CREATE OR REPLACE FUNCTION public.report_room_message(
  p_message_id UUID,
  p_reason TEXT
)
RETURNS public.message_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT;
  v_msg public.room_messages%ROWTYPE;
  v_report public.message_reports%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_reason := btrim(COALESCE(p_reason, ''));
  IF char_length(v_reason) < 1 OR char_length(v_reason) > 300 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO v_msg
  FROM public.room_messages
  WHERE id = p_message_id
    AND is_deleted = FALSE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  IF NOT public.is_active_member(v_msg.room_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF v_msg.sender_id = v_user_id THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  INSERT INTO public.message_reports (
    message_id,
    room_id,
    reporter_id,
    reason
  )
  VALUES (
    v_msg.id,
    v_msg.room_id,
    v_user_id,
    v_reason
  )
  ON CONFLICT (message_id, reporter_id)
  DO UPDATE SET
    reason = EXCLUDED.reason,
    created_at = NOW()
  RETURNING * INTO v_report;

  RETURN v_report;
END;
$$;

-- ==========================================
-- 5. reorder_room_blocks
-- ==========================================
CREATE OR REPLACE FUNCTION public.reorder_room_blocks(
  p_room_id UUID,
  p_block_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_input_count INT;
  v_non_null_count INT;
  v_distinct_count INT;
  v_existing_ids UUID[];
  v_sorted_input_ids UUID[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' OR NOT public.is_room_active(p_room_id) THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  v_input_count := COALESCE(array_length(p_block_ids, 1), 0);
  IF p_block_ids IS NULL OR v_input_count = 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT ARRAY_AGG(b.id ORDER BY b.id)
  INTO v_existing_ids
  FROM (
    SELECT id
    FROM public.blocks
    WHERE room_id = p_room_id
    ORDER BY id
    FOR UPDATE
  ) b;

  SELECT
    COUNT(*)::INT,
    COUNT(DISTINCT u.block_id)::INT
  INTO v_non_null_count, v_distinct_count
  FROM unnest(p_block_ids) AS u(block_id)
  WHERE u.block_id IS NOT NULL;

  IF v_non_null_count <> v_input_count OR v_distinct_count <> v_input_count THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT ARRAY_AGG(u.block_id ORDER BY u.block_id)
  INTO v_sorted_input_ids
  FROM unnest(p_block_ids) AS u(block_id);

  IF v_existing_ids IS NULL OR v_sorted_input_ids IS DISTINCT FROM v_existing_ids THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  UPDATE public.blocks AS b
  SET sort_order = (ord.pos - 1)::INT,
      updated_at = NOW()
  FROM unnest(p_block_ids) WITH ORDINALITY AS ord(block_id, pos)
  WHERE b.id = ord.block_id
    AND b.room_id = p_room_id;
END;
$$;

-- ==========================================
-- 6. leave_room
-- ==========================================
CREATE OR REPLACE FUNCTION public.leave_room(
  p_room_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_member public.room_members%ROWTYPE;
  v_member_nickname TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' OR NOT public.is_room_active(p_room_id) THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  SELECT * INTO v_member
  FROM public.room_members
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF v_member.role = 'host' THEN
    RAISE EXCEPTION 'HOST_CANNOT_LEAVE';
  END IF;

  SELECT nickname INTO v_member_nickname
  FROM public.profiles
  WHERE id = v_user_id;

  DELETE FROM public.room_chat_reads
  WHERE room_id = p_room_id
    AND user_id = v_user_id;

  DELETE FROM public.room_members
  WHERE id = v_member.id;

  INSERT INTO public.activity_logs (
    room_id,
    actor_id,
    action,
    target_table,
    target_id,
    before_snapshot
  )
  VALUES (
    p_room_id,
    v_user_id,
    'leave_room',
    'room_members',
    v_member.id,
    to_jsonb(v_member) || jsonb_build_object('nickname', v_member_nickname)
  );
END;
$$;

-- ==========================================
-- 7. auto_archive_expired_rooms (service_role / postgres only)
-- ==========================================
CREATE OR REPLACE FUNCTION public.auto_archive_expired_rooms()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_archived_count INT := 0;
BEGIN
  PERFORM set_config('app.poproom_rpc', '1', true);

  UPDATE public.rooms
  SET status = 'archived',
      archived_at = NOW(),
      updated_at = NOW()
  WHERE status = 'active'
    AND event_end_at IS NOT NULL
    AND event_end_at <= NOW() - INTERVAL '7 days';

  GET DIAGNOSTICS v_archived_count = ROW_COUNT;
  RETURN v_archived_count;
END;
$$;

-- ==========================================
-- 8. Function execution privileges
-- ==========================================
REVOKE ALL ON FUNCTION public.create_room_with_template(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_room_with_template(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.send_room_message(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_room_message(UUID, TEXT, TEXT, JSONB) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.soft_delete_room_message(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_room_message(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.report_room_message(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_room_message(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reorder_room_blocks(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_room_blocks(UUID, UUID[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.leave_room(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_room(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.auto_archive_expired_rooms() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_archive_expired_rooms() TO service_role;

-- ==========================================
-- 9. Guarded idempotent pg_cron daily auto-archive job
-- Runs daily at 19:00 UTC (03:00 Asia/Shanghai) when pg_cron is enabled.
-- ==========================================
DO $$
DECLARE
  v_existing_job_id BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    FOR v_existing_job_id IN
      EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = ''poproom-auto-archive-daily'''
    LOOP
      EXECUTE format('SELECT cron.unschedule(%s)', v_existing_job_id);
    END LOOP;

    EXECUTE $cron$
      SELECT cron.schedule(
        'poproom-auto-archive-daily',
        '0 19 * * *',
        'SELECT public.auto_archive_expired_rooms();'
      )
    $cron$;
  END IF;
END;
$$;

-- Notify PostgREST to reload schema cache immediately after migration
NOTIFY pgrst, 'reload schema';
