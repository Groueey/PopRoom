-- 003_rpcs.sql
-- PopRoom Stage 1 MVP: Room code generator and 14 atomic SECURITY DEFINER RPCs

-- ==========================================
-- Helper: Generate globally unique 6-char room code
-- Uses 32 non-confusable characters (excludes 0, O, 1, I)
-- ==========================================
CREATE OR REPLACE FUNCTION public.generate_unique_room_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alphabet CONSTANT TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes BYTEA;
  v_code TEXT;
  v_idx INT;
  v_attempt INT := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'ROOM_CODE_GENERATION_FAILED';
    END IF;

    IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NOT NULL THEN
      v_bytes := extensions.gen_random_bytes(6);
    ELSE
      v_bytes := gen_random_bytes(6);
    END IF;

    v_code := '';
    FOR i IN 0..5 LOOP
      v_idx := (get_byte(v_bytes, i) % 32) + 1;
      v_code := v_code || substr(v_alphabet, v_idx, 1);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE room_code = v_code) THEN
      RETURN v_code;
    END IF;
  END LOOP;
END;
$$;

-- ==========================================
-- 1. create_room_with_template
-- ==========================================
CREATE OR REPLACE FUNCTION public.create_room_with_template(
  p_title TEXT,
  p_template_type TEXT,
  p_join_mode TEXT,
  p_announcement TEXT DEFAULT '',
  p_event_start_at TIMESTAMPTZ DEFAULT NULL,
  p_event_end_at TIMESTAMPTZ DEFAULT NULL
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

  IF p_template_type NOT IN ('campus', 'travel', 'party', 'custom') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  IF p_join_mode NOT IN ('passcode', 'approval') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  IF p_event_start_at IS NOT NULL
     AND p_event_end_at IS NOT NULL
     AND p_event_end_at < p_event_start_at THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  v_announcement := COALESCE(p_announcement, '');
  v_room_code := public.generate_unique_room_code();

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
    FALSE,
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
-- 2. join_room_by_code
-- ==========================================
CREATE OR REPLACE FUNCTION public.join_room_by_code(
  p_room_code TEXT,
  p_apply_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_code TEXT;
  v_note TEXT;
  v_room public.rooms%ROWTYPE;
  v_existing public.room_members%ROWTYPE;
  v_new_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'PROFILE_REQUIRED';
  END IF;

  v_code := upper(regexp_replace(COALESCE(p_room_code, ''), '[\s-]+', '', 'g'));
  IF v_code = '' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE room_code = v_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_apply_note, '')), '');

  SELECT * INTO v_existing
  FROM public.room_members
  WHERE room_id = v_room.id
    AND user_id = v_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'kicked' THEN
      RAISE EXCEPTION 'USER_KICKED';
    END IF;

    IF v_existing.status IN ('active', 'pending') THEN
      RETURN jsonb_build_object(
        'room_id', v_room.id,
        'status', v_existing.status,
        'title', v_room.title
      );
    END IF;

    -- Previously rejected applicant can re-apply in approval mode (or enter directly in passcode mode)
    IF v_room.join_mode = 'passcode' THEN
      v_new_status := 'active';
    ELSE
      v_new_status := 'pending';
    END IF;

    UPDATE public.room_members
    SET status = v_new_status,
        apply_note = v_note,
        joined_at = NOW()
    WHERE id = v_existing.id;

    RETURN jsonb_build_object(
      'room_id', v_room.id,
      'status', v_new_status,
      'title', v_room.title
    );
  END IF;

  IF v_room.join_mode = 'passcode' THEN
    v_new_status := 'active';
  ELSE
    v_new_status := 'pending';
  END IF;

  INSERT INTO public.room_members (room_id, user_id, role, status, apply_note)
  VALUES (v_room.id, v_user_id, 'member', v_new_status, v_note);

  RETURN jsonb_build_object(
    'room_id', v_room.id,
    'status', v_new_status,
    'title', v_room.title
  );
END;
$$;

-- ==========================================
-- 3. review_member_application
-- ==========================================
CREATE OR REPLACE FUNCTION public.review_member_application(
  p_room_id UUID,
  p_target_user_id UUID,
  p_decision TEXT
)
RETURNS public.room_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_member public.room_members%ROWTYPE;
  v_target_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_decision IN ('active', 'approve') THEN
    v_target_status := 'active';
  ELSIF p_decision IN ('rejected', 'reject') THEN
    v_target_status := 'rejected';
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_member
  FROM public.room_members
  WHERE room_id = p_room_id
    AND user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF v_member.status <> 'pending' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  UPDATE public.room_members
  SET status = v_target_status,
      joined_at = CASE WHEN v_target_status = 'active' THEN NOW() ELSE joined_at END
  WHERE id = v_member.id
  RETURNING * INTO v_member;

  RETURN v_member;
END;
$$;

-- ==========================================
-- 4. update_member_role
-- ==========================================
CREATE OR REPLACE FUNCTION public.update_member_role(
  p_room_id UUID,
  p_target_user_id UUID,
  p_role TEXT
)
RETURNS public.room_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_member public.room_members%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_room_host(p_room_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_target_user_id = v_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_member
  FROM public.room_members
  WHERE room_id = p_room_id
    AND user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_member.status <> 'active' THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF v_member.role = 'host' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.room_members
  SET role = p_role
  WHERE id = v_member.id
  RETURNING * INTO v_member;

  RETURN v_member;
END;
$$;

-- ==========================================
-- 5. kick_room_member
-- ==========================================
CREATE OR REPLACE FUNCTION public.kick_room_member(
  p_room_id UUID,
  p_target_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_caller_role TEXT;
  v_target public.room_members%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF p_target_user_id = v_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.room_members
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND status = 'active';

  SELECT * INTO v_target
  FROM public.room_members
  WHERE room_id = p_room_id
    AND user_id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF v_target.status = 'kicked' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  IF v_target.role = 'host' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF v_target.role = 'admin' AND v_caller_role <> 'host' THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.room_members
  SET status = 'kicked'
  WHERE id = v_target.id;

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
    'kick_member',
    'room_members',
    v_target.id,
    to_jsonb(v_target)
  );
END;
$$;

-- ==========================================
-- 6. reset_room_code
-- ==========================================
CREATE OR REPLACE FUNCTION public.reset_room_code(
  p_room_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.rooms%ROWTYPE;
  v_new_code TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  v_new_code := public.generate_unique_room_code();

  UPDATE public.rooms
  SET room_code = v_new_code,
      updated_at = NOW()
  WHERE id = p_room_id;

  RETURN v_new_code;
END;
$$;

-- ==========================================
-- 7. toggle_poll_vote
-- ==========================================
CREATE OR REPLACE FUNCTION public.toggle_poll_vote(
  p_item_id UUID
)
RETURNS TABLE (
  item_id UUID,
  block_id UUID,
  vote_count INT,
  my_voted BOOLEAN,
  voter_ids UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_user_id UUID := auth.uid();
  v_item public.block_items%ROWTYPE;
  v_block public.blocks%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_is_locked BOOLEAN;
  v_multiple BOOLEAN;
  v_anonymous BOOLEAN;
  v_deadline_raw TEXT;
  v_already_voted BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_item
  FROM public.block_items
  WHERE id = p_item_id
    AND is_deleted = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  SELECT * INTO v_block
  FROM public.blocks
  WHERE id = v_item.block_id
  FOR UPDATE;

  IF NOT FOUND OR v_block.type <> 'poll' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_item.room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_active_member(v_item.room_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  v_is_locked := CASE
    WHEN jsonb_typeof(v_block.config->'isLocked') = 'boolean'
      THEN (v_block.config->>'isLocked')::boolean
    ELSE FALSE
  END;

  IF v_is_locked THEN
    RAISE EXCEPTION 'POLL_LOCKED';
  END IF;

  v_deadline_raw := NULLIF(btrim(COALESCE(v_block.config->>'deadline', '')), '');
  IF v_deadline_raw IS NOT NULL AND v_deadline_raw::timestamptz < NOW() THEN
    RAISE EXCEPTION 'POLL_EXPIRED';
  END IF;

  v_multiple := CASE
    WHEN jsonb_typeof(v_block.config->'multiple') = 'boolean'
      THEN (v_block.config->>'multiple')::boolean
    ELSE FALSE
  END;

  v_anonymous := CASE
    WHEN jsonb_typeof(v_block.config->'anonymous') = 'boolean'
      THEN (v_block.config->>'anonymous')::boolean
    ELSE FALSE
  END;

  SELECT EXISTS (
    SELECT 1
    FROM public.poll_votes pv
    WHERE pv.item_id = p_item_id
      AND pv.user_id = v_user_id
  )
  INTO v_already_voted;

  IF v_already_voted THEN
    DELETE FROM public.poll_votes pv
    WHERE pv.item_id = p_item_id
      AND pv.user_id = v_user_id;
  ELSE
    IF NOT v_multiple THEN
      DELETE FROM public.poll_votes pv
      WHERE pv.block_id = v_block.id
        AND pv.user_id = v_user_id;
    END IF;

    INSERT INTO public.poll_votes (room_id, block_id, item_id, user_id)
    VALUES (v_item.room_id, v_block.id, p_item_id, v_user_id)
    ON CONFLICT (item_id, user_id) DO NOTHING;
  END IF;

  -- Touch block_items.updated_at so Realtime subscribers re-fetch poll tallies without exposing poll_votes
  UPDATE public.block_items
  SET updated_at = NOW()
  WHERE id = p_item_id;

  RETURN QUERY
  SELECT
    bi.id AS item_id,
    bi.block_id AS block_id,
    COUNT(pv.id)::INT AS vote_count,
    COALESCE(BOOL_OR(pv.user_id = v_user_id), FALSE) AS my_voted,
    CASE
      WHEN v_anonymous THEN '{}'::uuid[]
      ELSE COALESCE(
        ARRAY_AGG(pv.user_id ORDER BY pv.created_at) FILTER (WHERE pv.user_id IS NOT NULL),
        '{}'::uuid[]
      )
    END AS voter_ids
  FROM public.block_items bi
  LEFT JOIN public.poll_votes pv ON pv.item_id = bi.id
  WHERE bi.block_id = v_block.id
    AND bi.is_deleted = FALSE
  GROUP BY bi.id, bi.block_id;
END;
$$;

-- ==========================================
-- 8. get_room_poll_tallies
-- ==========================================
CREATE OR REPLACE FUNCTION public.get_room_poll_tallies(
  p_room_id UUID
)
RETURNS TABLE (
  item_id UUID,
  block_id UUID,
  vote_count INT,
  my_voted BOOLEAN,
  voter_ids UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE id = p_room_id) THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF NOT public.is_active_member(p_room_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  RETURN QUERY
  SELECT
    bi.id AS item_id,
    bi.block_id AS block_id,
    COUNT(pv.id)::INT AS vote_count,
    COALESCE(BOOL_OR(pv.user_id = v_user_id), FALSE) AS my_voted,
    CASE
      WHEN CASE
        WHEN jsonb_typeof(b.config->'anonymous') = 'boolean'
          THEN (b.config->>'anonymous')::boolean
        ELSE FALSE
      END THEN '{}'::uuid[]
      ELSE COALESCE(
        ARRAY_AGG(pv.user_id ORDER BY pv.created_at) FILTER (WHERE pv.user_id IS NOT NULL),
        '{}'::uuid[]
      )
    END AS voter_ids
  FROM public.block_items bi
  JOIN public.blocks b ON b.id = bi.block_id
  LEFT JOIN public.poll_votes pv ON pv.item_id = bi.id
  WHERE bi.room_id = p_room_id
    AND bi.is_deleted = FALSE
    AND b.type = 'poll'
  GROUP BY bi.id, bi.block_id, b.config;
END;
$$;

-- ==========================================
-- 9. toggle_task_claim
-- ==========================================
CREATE OR REPLACE FUNCTION public.toggle_task_claim(
  p_item_id UUID
)
RETURNS public.block_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_item public.block_items%ROWTYPE;
  v_block public.blocks%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_assignees TEXT[];
  v_status TEXT;
  v_user_text TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_item
  FROM public.block_items
  WHERE id = p_item_id
    AND is_deleted = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  SELECT * INTO v_block
  FROM public.blocks
  WHERE id = v_item.block_id;

  IF NOT FOUND OR v_block.type <> 'task' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_item.room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_active_member(v_item.room_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  SELECT COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item.data->'assigneeIds', '[]'::jsonb))),
    '{}'::TEXT[]
  )
  INTO v_assignees;

  v_status := COALESCE(v_item.data->>'status', 'unclaimed');
  v_user_text := v_user_id::text;

  IF v_user_text = ANY(v_assignees) THEN
    v_assignees := array_remove(v_assignees, v_user_text);
    IF array_length(v_assignees, 1) IS NULL AND v_status = 'in_progress' THEN
      v_status := 'unclaimed';
    END IF;
  ELSE
    v_assignees := array_append(v_assignees, v_user_text);
    IF v_status = 'unclaimed' THEN
      v_status := 'in_progress';
    END IF;
  END IF;

  UPDATE public.block_items
  SET data = jsonb_set(
        jsonb_set(v_item.data, '{assigneeIds}', to_jsonb(v_assignees), TRUE),
        '{status}',
        to_jsonb(v_status),
        TRUE
      ),
      updated_at = NOW()
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  RETURN v_item;
END;
$$;

-- ==========================================
-- 10. set_task_status
-- ==========================================
CREATE OR REPLACE FUNCTION public.set_task_status(
  p_item_id UUID,
  p_status TEXT
)
RETURNS public.block_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_item public.block_items%ROWTYPE;
  v_block public.blocks%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_assignees TEXT[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF p_status NOT IN ('unclaimed', 'in_progress', 'done') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO v_item
  FROM public.block_items
  WHERE id = p_item_id
    AND is_deleted = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  SELECT * INTO v_block
  FROM public.blocks
  WHERE id = v_item.block_id;

  IF NOT FOUND OR v_block.type <> 'task' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_item.room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_active_member(v_item.room_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  SELECT COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item.data->'assigneeIds', '[]'::jsonb))),
    '{}'::TEXT[]
  )
  INTO v_assignees;

  IF NOT (
    public.is_room_admin(v_item.room_id)
    OR v_item.created_by = v_user_id
    OR (v_user_id::text = ANY(v_assignees))
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.block_items
  SET data = jsonb_set(v_item.data, '{status}', to_jsonb(p_status), TRUE),
      updated_at = NOW()
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  RETURN v_item;
END;
$$;

-- ==========================================
-- 11. update_task_images
-- ==========================================
CREATE OR REPLACE FUNCTION public.update_task_images(
  p_item_id UUID,
  p_image_urls TEXT[]
)
RETURNS public.block_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_urls TEXT[];
  v_len INT;
  v_item public.block_items%ROWTYPE;
  v_block public.blocks%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_assignees TEXT[];
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_urls := COALESCE(p_image_urls, '{}'::TEXT[]);
  v_len := COALESCE(array_length(v_urls, 1), 0);

  IF v_len > 3 THEN
    RAISE EXCEPTION 'MAX_IMAGES_EXCEEDED';
  END IF;

  IF v_len > 0 THEN
    FOR i IN 1..v_len LOOP
      IF v_urls[i] IS NULL OR btrim(v_urls[i]) = '' THEN
        RAISE EXCEPTION 'INVALID_INPUT';
      END IF;
    END LOOP;
  END IF;

  SELECT * INTO v_item
  FROM public.block_items
  WHERE id = p_item_id
    AND is_deleted = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  SELECT * INTO v_block
  FROM public.blocks
  WHERE id = v_item.block_id;

  IF NOT FOUND OR v_block.type <> 'task' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_item.room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_active_member(v_item.room_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  SELECT COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item.data->'assigneeIds', '[]'::jsonb))),
    '{}'::TEXT[]
  )
  INTO v_assignees;

  IF NOT (
    public.is_room_admin(v_item.room_id)
    OR v_item.created_by = v_user_id
    OR (v_user_id::text = ANY(v_assignees))
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.block_items
  SET data = jsonb_set(v_item.data, '{imageUrls}', to_jsonb(v_urls), TRUE),
      updated_at = NOW()
  WHERE id = p_item_id
  RETURNING * INTO v_item;

  RETURN v_item;
END;
$$;

-- ==========================================
-- 12. soft_delete_block_item
-- ==========================================
CREATE OR REPLACE FUNCTION public.soft_delete_block_item(
  p_item_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_item public.block_items%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_log_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_item
  FROM public.block_items
  WHERE id = p_item_id
    AND is_deleted = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_item.room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_active_member(v_item.room_id) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER';
  END IF;

  IF NOT (v_item.created_by = v_user_id OR public.is_room_admin(v_item.room_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.block_items
  SET is_deleted = TRUE,
      updated_at = NOW()
  WHERE id = p_item_id;

  INSERT INTO public.activity_logs (
    room_id,
    actor_id,
    action,
    target_table,
    target_id,
    before_snapshot
  )
  VALUES (
    v_item.room_id,
    v_user_id,
    'delete_item',
    'block_items',
    v_item.id,
    to_jsonb(v_item)
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- ==========================================
-- 13. restore_deleted_item
-- ==========================================
CREATE OR REPLACE FUNCTION public.restore_deleted_item(
  p_log_id UUID
)
RETURNS public.block_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_log public.activity_logs%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_item public.block_items%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_log
  FROM public.activity_logs
  WHERE id = p_log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_log.room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_room_admin(v_log.room_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF v_log.action <> 'delete_item' OR v_log.target_table <> 'block_items' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  IF v_log.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'LOG_ALREADY_RESTORED';
  END IF;

  SELECT * INTO v_item
  FROM public.block_items
  WHERE id = v_log.target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  IF v_item.is_deleted = FALSE THEN
    RAISE EXCEPTION 'LOG_ALREADY_RESTORED';
  END IF;

  UPDATE public.block_items
  SET is_deleted = FALSE,
      updated_at = NOW()
  WHERE id = v_item.id
  RETURNING * INTO v_item;

  UPDATE public.activity_logs
  SET restored_at = NOW()
  WHERE id = v_log.id;

  INSERT INTO public.activity_logs (
    room_id,
    actor_id,
    action,
    target_table,
    target_id,
    before_snapshot
  )
  VALUES (
    v_log.room_id,
    v_user_id,
    'restore_item',
    'block_items',
    v_item.id,
    v_log.before_snapshot
  );

  RETURN v_item;
END;
$$;

-- ==========================================
-- 14. archive_room
-- ==========================================
CREATE OR REPLACE FUNCTION public.archive_room(
  p_room_id UUID
)
RETURNS public.rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_room public.rooms%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROOM_NOT_FOUND';
  END IF;

  IF v_room.status = 'archived' THEN
    RAISE EXCEPTION 'ROOM_ARCHIVED';
  END IF;

  IF NOT public.is_room_host(p_room_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.rooms
  SET status = 'archived',
      archived_at = NOW(),
      updated_at = NOW()
  WHERE id = p_room_id
  RETURNING * INTO v_room;

  RETURN v_room;
END;
$$;

-- ==========================================
-- Function execution privileges
-- ==========================================
REVOKE ALL ON FUNCTION public.generate_unique_room_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_unique_room_code() TO service_role;

REVOKE ALL ON FUNCTION public.create_room_with_template(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_room_with_template(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.join_room_by_code(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_room_by_code(TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.review_member_application(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_member_application(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_member_role(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_member_role(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.kick_room_member(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kick_room_member(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reset_room_code(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_room_code(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.toggle_poll_vote(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_poll_vote(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_room_poll_tallies(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_poll_tallies(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.toggle_task_claim(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_task_claim(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_task_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_task_status(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_task_images(UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_task_images(UUID, TEXT[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.soft_delete_block_item(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_block_item(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.restore_deleted_item(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_deleted_item(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.archive_room(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_room(UUID) TO authenticated, service_role;
