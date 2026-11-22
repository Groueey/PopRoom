import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = path.resolve(__dirname, '../..');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'supabase', 'migrations');
const SCHEMA_SQL_PATH = path.join(MIGRATIONS_DIR, '001_initial_schema.sql');
const RLS_SQL_PATH = path.join(MIGRATIONS_DIR, '002_rls_policies.sql');
const RPCS_SQL_PATH = path.join(MIGRATIONS_DIR, '003_rpcs.sql');
const README_PATH = path.join(ROOT_DIR, 'supabase', 'README.md');

function readSql(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractFunctionBody(sql: string, fnName: string): string {
  const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${escaped}\\b([\\s\\S]*?)\\$\\$;`,
    'i',
  );
  const match = sql.match(pattern);
  if (!match) {
    throw new Error(`Function ${fnName} not found`);
  }
  return match[0];
}

describe('Supabase migration contracts', () => {
  describe('001_initial_schema.sql', () => {
    it('defines all 8 core tables with required columns, constraints, and indexes', () => {
      const raw = readSql(SCHEMA_SQL_PATH);
      const sql = stripSqlComments(raw);

      const expectedTables = [
        'profiles',
        'rooms',
        'room_members',
        'blocks',
        'block_items',
        'poll_votes',
        'item_comments',
        'activity_logs',
      ];

      for (const table of expectedTables) {
        expect(sql).toMatch(
          new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\b`, 'i'),
        );
      }

      // Unified 6-char room_code & Stage 2 reserved chat_enabled = FALSE
      expect(sql).toMatch(/room_code\s+TEXT\s+UNIQUE\s+NOT\s+NULL/i);
      expect(sql).toMatch(/chat_enabled\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i);

      // Required CHECK constraints
      expect(sql).toMatch(/template_type[\s\S]*?'campus'[\s\S]*?'travel'[\s\S]*?'party'[\s\S]*?'custom'/i);
      expect(sql).toMatch(/join_mode[\s\S]*?'passcode'[\s\S]*?'approval'/i);
      expect(sql).toMatch(/status[\s\S]*?'active'[\s\S]*?'archived'/i);
      expect(sql).toMatch(/role[\s\S]*?'host'[\s\S]*?'admin'[\s\S]*?'member'/i);
      expect(sql).toMatch(/status[\s\S]*?'pending'[\s\S]*?'active'[\s\S]*?'rejected'[\s\S]*?'kicked'/i);
      expect(sql).toMatch(/type[\s\S]*?'poll'[\s\S]*?'task'[\s\S]*?'schedule'[\s\S]*?'expense'/i);
      expect(sql).toMatch(
        /action[\s\S]*?'delete_item'[\s\S]*?'restore_item'[\s\S]*?'update_room'[\s\S]*?'kick_member'/i,
      );

      // Unique constraints on room_members & poll_votes
      expect(sql).toMatch(/UNIQUE\s*\(\s*room_id\s*,\s*user_id\s*\)/i);
      expect(sql).toMatch(/UNIQUE\s*\(\s*item_id\s*,\s*user_id\s*\)/i);

      // Required indexes
      const expectedIndexes = [
        'idx_room_members_user',
        'idx_room_members_room',
        'idx_blocks_room',
        'idx_block_items_room',
        'idx_poll_votes_room_block',
        'idx_poll_votes_block_user',
        'idx_item_comments_item',
        'idx_activity_logs_room',
      ];

      for (const idx of expectedIndexes) {
        expect(sql).toMatch(new RegExp(`CREATE\\s+INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${idx}\\b`, 'i'));
      }
    });

    it('configures supabase_realtime for 5 tables and strictly excludes poll_votes (Review Focus #3)', () => {
      const sql = stripSqlComments(readSql(SCHEMA_SQL_PATH));
      const pubMatches = sql.match(/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+[\s\S]*?;/gi);
      expect(pubMatches).not.toBeNull();
      const pubStatement = (pubMatches ?? []).join(' ');

      for (const table of ['rooms', 'room_members', 'blocks', 'block_items', 'item_comments']) {
        expect(pubStatement).toMatch(new RegExp(`\\b${table}\\b`, 'i'));
      }
      expect(pubStatement).not.toMatch(/\bpoll_votes\b/i);
    });
  });

  describe('002_rls_policies.sql', () => {
    it('enables RLS on all 8 tables and defines 5 SECURITY DEFINER helpers with search_path = public', () => {
      const sql = stripSqlComments(readSql(RLS_SQL_PATH));

      const tables = [
        'profiles',
        'rooms',
        'room_members',
        'blocks',
        'block_items',
        'poll_votes',
        'item_comments',
        'activity_logs',
      ];
      for (const table of tables) {
        expect(sql).toMatch(
          new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'),
        );
      }

      const helpers = [
        'is_active_member',
        'is_room_admin',
        'is_room_host',
        'is_room_active',
        'is_poll_anonymous',
      ];
      for (const fn of helpers) {
        const body = extractFunctionBody(sql, fn);
        expect(body).toMatch(/SECURITY\s+DEFINER/i);
        expect(body).toMatch(/SET\s+search_path\s*=\s*public\b/i);
        expect(sql).toMatch(
          new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(\\s*UUID\\s*\\)\\s+FROM\\s+PUBLIC`, 'i'),
        );
        expect(sql).toMatch(
          new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(\\s*UUID\\s*\\)\\s+TO\\s+authenticated\\s*,\\s*service_role`, 'i'),
        );
      }
    });

    it('enforces archive write-lock, block_items edit isolation, and no direct delete/write leaks (Review Focus #4)', () => {
      const sql = stripSqlComments(readSql(RLS_SQL_PATH));

      // Every write policy on room-scoped tables must enforce is_room_active
      const writePolicies = [
        ...sql.matchAll(
          /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?(rooms|blocks|block_items|item_comments)\s+FOR\s+(INSERT|UPDATE|DELETE)\b[\s\S]*?;/gi,
        ),
      ];
      expect(writePolicies.length).toBeGreaterThanOrEqual(5);
      for (const policy of writePolicies) {
        expect(policy[0]).toMatch(/is_room_active\s*\(/i);
      }

      // block_items UPDATE restricted to active members (creator or admin), active room, and valid parent block
      const blockItemUpdateMatch = sql.match(
        /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?block_items\s+FOR\s+UPDATE\b[\s\S]*?;/i,
      );
      expect(blockItemUpdateMatch).not.toBeNull();
      const blockItemUpdateSql = blockItemUpdateMatch?.[0] ?? '';
      expect(blockItemUpdateSql).toMatch(/USING\s*\([\s\S]*?is_active_member\s*\(\s*room_id\s*\)[\s\S]*?\)\s*WITH\s+CHECK/i);
      expect(blockItemUpdateSql).toMatch(/WITH\s+CHECK\s*\([\s\S]*?is_active_member\s*\(\s*room_id\s*\)/i);
      expect(blockItemUpdateSql).toMatch(/is_room_active\s*\(\s*room_id\s*\)/i);
      expect(blockItemUpdateSql).toMatch(/created_by\s*=\s*auth\.uid\(\)/i);
      expect(blockItemUpdateSql).toMatch(/is_room_admin\s*\(\s*room_id\s*\)/i);
      expect(blockItemUpdateSql).toMatch(
        /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+(?:public\.)?blocks\s+b\s+WHERE\s+b\.id\s*=\s*block_id\s+AND\s+b\.room_id\s*=\s*block_items\.room_id/i,
      );
      expect(blockItemUpdateSql).toMatch(/isLocked/i);

      // Immutability triggers on block_items, blocks, and rooms UPDATE (Important #3)
      const blockItemImmutableFn = extractFunctionBody(sql, 'prevent_block_item_immutable_update');
      expect(blockItemImmutableFn).toMatch(/SET\s+search_path\s*=\s*public\b/i);
      expect(blockItemImmutableFn).toMatch(/NEW\.room_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.room_id/i);
      expect(blockItemImmutableFn).toMatch(/NEW\.block_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.block_id/i);
      expect(blockItemImmutableFn).toMatch(/NEW\.created_by\s+IS\s+DISTINCT\s+FROM\s+OLD\.created_by/i);
      expect(blockItemImmutableFn).toMatch(/NEW\.is_deleted\s+IS\s+DISTINCT\s+FROM\s+OLD\.is_deleted/i);
      expect(blockItemImmutableFn).toMatch(/current_setting\s*\(\s*'app\.poproom_rpc'\s*,\s*true\s*\)/i);
      expect(sql).toMatch(
        /CREATE\s+TRIGGER\s+\S+\s+BEFORE\s+UPDATE\s+ON\s+(?:public\.)?block_items[\s\S]*?EXECUTE\s+FUNCTION\s+(?:public\.)?prevent_block_item_immutable_update\s*\(\s*\)/i,
      );

      const blockImmutableFn = extractFunctionBody(sql, 'prevent_block_immutable_update');
      expect(blockImmutableFn).toMatch(/SET\s+search_path\s*=\s*public\b/i);
      expect(blockImmutableFn).toMatch(/NEW\.room_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.room_id/i);
      expect(blockImmutableFn).toMatch(/NEW\.type\s+IS\s+DISTINCT\s+FROM\s+OLD\.type/i);
      expect(blockImmutableFn).toMatch(/NEW\.created_by\s+IS\s+DISTINCT\s+FROM\s+OLD\.created_by/i);
      expect(sql).toMatch(
        /CREATE\s+TRIGGER\s+\S+\s+BEFORE\s+UPDATE\s+ON\s+(?:public\.)?blocks[\s\S]*?EXECUTE\s+FUNCTION\s+(?:public\.)?prevent_block_immutable_update\s*\(\s*\)/i,
      );

      const roomImmutableFn = extractFunctionBody(sql, 'prevent_room_immutable_update');
      expect(roomImmutableFn).toMatch(/SET\s+search_path\s*=\s*public\b/i);
      expect(roomImmutableFn).toMatch(/NEW\.template_type\s+IS\s+DISTINCT\s+FROM\s+OLD\.template_type/i);
      expect(roomImmutableFn).toMatch(/NEW\.created_by\s+IS\s+DISTINCT\s+FROM\s+OLD\.created_by/i);
      expect(roomImmutableFn).toMatch(/NEW\.room_code\s+IS\s+DISTINCT\s+FROM\s+OLD\.room_code/i);
      expect(roomImmutableFn).toMatch(/NEW\.status\s+IS\s+DISTINCT\s+FROM\s+OLD\.status/i);
      expect(roomImmutableFn).toMatch(/NEW\.archived_at\s+IS\s+DISTINCT\s+FROM\s+OLD\.archived_at/i);
      expect(roomImmutableFn).toMatch(/NEW\.chat_enabled\s+IS\s+DISTINCT\s+FROM\s+OLD\.chat_enabled/i);
      expect(roomImmutableFn).toMatch(/current_setting\s*\(\s*'app\.poproom_rpc'\s*,\s*true\s*\)/i);
      expect(sql).toMatch(
        /CREATE\s+TRIGGER\s+\S+\s+BEFORE\s+UPDATE\s+ON\s+(?:public\.)?rooms[\s\S]*?EXECUTE\s+FUNCTION\s+(?:public\.)?prevent_room_immutable_update\s*\(\s*\)/i,
      );

      // item_comments DELETE must block kicked/inactive members
      const commentDeleteMatch = sql.match(
        /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?item_comments\s+FOR\s+DELETE\b[\s\S]*?;/i,
      );
      expect(commentDeleteMatch).not.toBeNull();
      expect(commentDeleteMatch?.[0]).toMatch(/is_active_member\s*\(\s*room_id\s*\)/i);
      expect(commentDeleteMatch?.[0]).toMatch(/is_room_active\s*\(\s*room_id\s*\)/i);

      // No direct DELETE policy on block_items
      expect(sql).not.toMatch(/ON\s+(?:public\.)?block_items\s+FOR\s+DELETE\b/i);

      // No direct write policies on poll_votes or activity_logs
      expect(sql).not.toMatch(/ON\s+(?:public\.)?poll_votes\s+FOR\s+(INSERT|UPDATE|DELETE)\b/i);
      expect(sql).not.toMatch(/ON\s+(?:public\.)?activity_logs\s+FOR\s+(INSERT|UPDATE|DELETE)\b/i);

      // poll_votes SELECT must guard anonymous polls via is_poll_anonymous
      const pollVotesSelect = sql.match(
        /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?poll_votes\s+FOR\s+SELECT\b[\s\S]*?;/i,
      );
      expect(pollVotesSelect).not.toBeNull();
      expect(pollVotesSelect?.[0]).toMatch(/is_poll_anonymous\s*\(\s*block_id\s*\)/i);
    });

    it('creates private room-media storage bucket and room-scoped storage.objects policies', () => {
      const sql = stripSqlComments(readSql(RLS_SQL_PATH));

      expect(sql).toMatch(/INSERT\s+INTO\s+storage\.buckets[\s\S]*?'room-media'/i);
      expect(sql).toMatch(/public\s*=\s*FALSE|VALUES\s*\([^;]*?FALSE/i);

      const storagePolicies = [
        ...sql.matchAll(/CREATE\s+POLICY\s+\S+\s+ON\s+storage\.objects\b[\s\S]*?;/gi),
      ];
      expect(storagePolicies.length).toBeGreaterThanOrEqual(2);
      const storageSql = storagePolicies.map((m) => m[0]).join('\n');
      expect(storageSql).toMatch(/bucket_id\s*=\s*'room-media'/i);
      expect(storageSql).toMatch(/is_active_member\s*\(\s*\(storage\.foldername\(name\)\)\[1\]::uuid\s*\)/i);
      expect(storageSql).toMatch(/is_room_active\s*\(\s*\(storage\.foldername\(name\)\)\[1\]::uuid\s*\)/i);
    });
  });

  describe('003_rpcs.sql', () => {
    const ALL_14_RPCS = [
      'create_room_with_template',
      'join_room_by_code',
      'review_member_application',
      'update_member_role',
      'kick_room_member',
      'reset_room_code',
      'toggle_poll_vote',
      'get_room_poll_tallies',
      'toggle_task_claim',
      'set_task_status',
      'update_task_images',
      'soft_delete_block_item',
      'restore_deleted_item',
      'archive_room',
    ] as const;

    it('defines generate_unique_room_code and all 14 RPCs with SECURITY DEFINER and SET search_path = public', () => {
      const sql = stripSqlComments(readSql(RPCS_SQL_PATH));

      const genCode = extractFunctionBody(sql, 'generate_unique_room_code');
      expect(genCode).toMatch(/SECURITY\s+DEFINER/i);
      expect(genCode).toMatch(/SET\s+search_path\s*=\s*public\b/i);
      expect(genCode).toContain('23456789ABCDEFGHJKLMNPQRSTUVWXYZ');
      expect(genCode).toMatch(/gen_random_bytes\s*\(/i);

      for (const rpc of ALL_14_RPCS) {
        const body = extractFunctionBody(sql, rpc);
        expect(body).toMatch(/SECURITY\s+DEFINER/i);
        expect(body).toMatch(/SET\s+search_path\s*=\s*public\b/i);
      }

      // Verify exact RPC parameter names and defaults match Task 2 brief
      expect(extractFunctionBody(sql, 'create_room_with_template')).toMatch(
        /p_title\s+TEXT[\s\S]*?p_template_type\s+TEXT[\s\S]*?p_join_mode\s+TEXT[\s\S]*?p_announcement\s+TEXT\s+DEFAULT\s+''[\s\S]*?p_event_start_at\s+TIMESTAMPTZ\s+DEFAULT\s+NULL[\s\S]*?p_event_end_at\s+TIMESTAMPTZ\s+DEFAULT\s+NULL[\s\S]*?RETURNS\s+(?:public\.)?rooms/i,
      );
      expect(extractFunctionBody(sql, 'join_room_by_code')).toMatch(
        /p_room_code\s+TEXT[\s\S]*?p_apply_note\s+TEXT\s+DEFAULT\s+NULL[\s\S]*?RETURNS\s+JSONB/i,
      );
      expect(extractFunctionBody(sql, 'review_member_application')).toMatch(
        /p_room_id\s+UUID[\s\S]*?p_target_user_id\s+UUID[\s\S]*?p_decision\s+TEXT[\s\S]*?RETURNS\s+(?:public\.)?room_members/i,
      );
      expect(extractFunctionBody(sql, 'update_member_role')).toMatch(
        /p_room_id\s+UUID[\s\S]*?p_target_user_id\s+UUID[\s\S]*?p_role\s+TEXT[\s\S]*?RETURNS\s+(?:public\.)?room_members/i,
      );
      expect(extractFunctionBody(sql, 'kick_room_member')).toMatch(
        /p_room_id\s+UUID[\s\S]*?p_target_user_id\s+UUID[\s\S]*?RETURNS\s+VOID/i,
      );
      expect(extractFunctionBody(sql, 'reset_room_code')).toMatch(
        /p_room_id\s+UUID[\s\S]*?RETURNS\s+TEXT/i,
      );
      expect(extractFunctionBody(sql, 'toggle_poll_vote')).toMatch(
        /p_item_id\s+UUID[\s\S]*?RETURNS\s+TABLE[\s\S]*?item_id\s+UUID[\s\S]*?block_id\s+UUID[\s\S]*?vote_count\s+INT[\s\S]*?my_voted\s+BOOLEAN[\s\S]*?voter_ids\s+UUID\[\]/i,
      );
      expect(extractFunctionBody(sql, 'get_room_poll_tallies')).toMatch(
        /p_room_id\s+UUID[\s\S]*?RETURNS\s+TABLE[\s\S]*?item_id\s+UUID[\s\S]*?block_id\s+UUID[\s\S]*?vote_count\s+INT[\s\S]*?my_voted\s+BOOLEAN[\s\S]*?voter_ids\s+UUID\[\]/i,
      );
      expect(extractFunctionBody(sql, 'toggle_task_claim')).toMatch(
        /p_item_id\s+UUID[\s\S]*?RETURNS\s+(?:public\.)?block_items/i,
      );
      expect(extractFunctionBody(sql, 'set_task_status')).toMatch(
        /p_item_id\s+UUID[\s\S]*?p_status\s+TEXT[\s\S]*?RETURNS\s+(?:public\.)?block_items/i,
      );
      expect(extractFunctionBody(sql, 'update_task_images')).toMatch(
        /p_item_id\s+UUID[\s\S]*?p_image_urls\s+TEXT\[\][\s\S]*?RETURNS\s+(?:public\.)?block_items/i,
      );
      expect(extractFunctionBody(sql, 'soft_delete_block_item')).toMatch(
        /p_item_id\s+UUID[\s\S]*?RETURNS\s+UUID/i,
      );
      expect(extractFunctionBody(sql, 'restore_deleted_item')).toMatch(
        /p_log_id\s+UUID[\s\S]*?RETURNS\s+(?:public\.)?block_items/i,
      );
      expect(extractFunctionBody(sql, 'archive_room')).toMatch(
        /p_room_id\s+UUID[\s\S]*?RETURNS\s+(?:public\.)?rooms/i,
      );
    });

    it('enforces ROOM_ARCHIVED in every mutating RPC (Review Focus #4)', () => {
      const sql = stripSqlComments(readSql(RPCS_SQL_PATH));
      const mutatingRoomRpcs = [
        'join_room_by_code',
        'review_member_application',
        'update_member_role',
        'kick_room_member',
        'reset_room_code',
        'toggle_poll_vote',
        'toggle_task_claim',
        'set_task_status',
        'update_task_images',
        'soft_delete_block_item',
        'restore_deleted_item',
        'archive_room',
      ];

      for (const rpc of mutatingRoomRpcs) {
        const body = extractFunctionBody(sql, rpc);
        expect(body).toContain('ROOM_ARCHIVED');
      }

      // Prevent concurrent archive_room race via FOR SHARE on rooms row in all 10 room-mutating RPCs
      const shareLockedRpcs = [
        'join_room_by_code',
        'review_member_application',
        'update_member_role',
        'kick_room_member',
        'toggle_poll_vote',
        'toggle_task_claim',
        'set_task_status',
        'update_task_images',
        'soft_delete_block_item',
        'restore_deleted_item',
      ];
      for (const rpc of shareLockedRpcs) {
        const body = extractFunctionBody(sql, rpc);
        expect(body).toMatch(/FROM\s+(?:public\.)?rooms[\s\S]*?FOR\s+SHARE/i);
      }

      for (const rpc of ['reset_room_code', 'archive_room']) {
        const body = extractFunctionBody(sql, rpc);
        expect(body).toMatch(/FROM\s+(?:public\.)?rooms[\s\S]*?FOR\s+UPDATE/i);
      }
    });

    it('masks voter_ids when anonymous = true in poll RPCs (Review Focus #3)', () => {
      const sql = stripSqlComments(readSql(RPCS_SQL_PATH));

      for (const rpc of ['get_room_poll_tallies', 'toggle_poll_vote']) {
        const body = extractFunctionBody(sql, rpc);
        expect(body).toMatch(/anonymous/i);
        expect(body).toMatch(/'\{\}'::uuid\[\]/i);
      }

      const togglePoll = extractFunctionBody(sql, 'toggle_poll_vote');
      expect(togglePoll).toContain('POLL_LOCKED');
      expect(togglePoll).toContain('POLL_EXPIRED');
      expect(togglePoll).toMatch(/UPDATE\s+public\.block_items[\s\S]*?updated_at\s*=\s*NOW\(\)/i);
    });

    it('uses FOR UPDATE row locks in task RPCs and enforces max 3 images', () => {
      const sql = stripSqlComments(readSql(RPCS_SQL_PATH));

      for (const rpc of ['toggle_task_claim', 'set_task_status', 'update_task_images']) {
        const body = extractFunctionBody(sql, rpc);
        expect(body).toMatch(/FROM\s+public\.block_items[\s\S]*?is_deleted\s*=\s*FALSE[\s\S]*?FOR\s+UPDATE/i);
        expect(body).toMatch(/type\s*<>\s*'task'|type\s*=\s*'task'/i);
        expect(body).toMatch(/jsonb_typeof\s*\(\s*v_item\.data->'assigneeIds'\s*\)\s*=\s*'array'/i);
        expect(body).not.toMatch(/jsonb_array_elements_text\s*\(\s*COALESCE\s*\(/i);
      }

      // Guard against SQL NULL bypassing NOT IN (...) validation
      expect(extractFunctionBody(sql, 'set_task_status')).toMatch(
        /p_status\s+IS\s+NULL\s+OR\s+p_status\s+NOT\s+IN/i,
      );
      expect(extractFunctionBody(sql, 'update_member_role')).toMatch(
        /p_role\s+IS\s+NULL\s+OR\s+p_role\s+NOT\s+IN/i,
      );
      const createRoomBody = extractFunctionBody(sql, 'create_room_with_template');
      expect(createRoomBody).toMatch(/p_template_type\s+IS\s+NULL\s+OR\s+p_template_type\s+NOT\s+IN/i);
      expect(createRoomBody).toMatch(/p_join_mode\s+IS\s+NULL\s+OR\s+p_join_mode\s+NOT\s+IN/i);

      const updateImages = extractFunctionBody(sql, 'update_task_images');
      expect(updateImages).toContain('MAX_IMAGES_EXCEEDED');
      expect(updateImages).toMatch(/>\s*3\b/);
    });

    it('creates preset template blocks in create_room_with_template with chat_enabled = FALSE', () => {
      const sql = stripSqlComments(readSql(RPCS_SQL_PATH));
      const body = extractFunctionBody(sql, 'create_room_with_template');

      expect(body).toMatch(/chat_enabled/i);
      expect(body).toMatch(/FALSE/i);
      expect(body).toContain("'campus'");
      expect(body).toContain("'travel'");
      expect(body).toContain("'party'");
      expect(body).toContain("'custom'");
      expect(body).toContain('availability');
      expect(body).toContain('budget');
      expect(body).toContain('split');

      // Check preset block counts: campus (4), travel (4), party (2), custom (0)
      const campusSection = body.match(/p_template_type\s*=\s*'campus'\s+THEN([\s\S]*?)ELSIF\s+p_template_type\s*=\s*'travel'/i)?.[1] ?? '';
      expect(campusSection.match(/v_room\.id/g)?.length).toBe(4);
      const travelSection = body.match(/p_template_type\s*=\s*'travel'\s+THEN([\s\S]*?)ELSIF\s+p_template_type\s*=\s*'party'/i)?.[1] ?? '';
      expect(travelSection.match(/v_room\.id/g)?.length).toBe(4);
      const partySection = body.match(/p_template_type\s*=\s*'party'\s+THEN([\s\S]*?)ELSIF\s+p_template_type\s*=\s*'custom'/i)?.[1] ?? '';
      expect(partySection.match(/v_room\.id/g)?.length).toBe(2);
      const customSection = body.match(/p_template_type\s*=\s*'custom'\s+THEN([\s\S]*?)END\s+IF/i)?.[1] ?? '';
      expect(customSection).not.toMatch(/INSERT\s+INTO/i);
    });

    it('includes all documented domain error tokens across RPCs', () => {
      const sql = stripSqlComments(readSql(RPCS_SQL_PATH));
      const expectedTokens = [
        'NOT_AUTHENTICATED',
        'PROFILE_REQUIRED',
        'ROOM_NOT_FOUND',
        'ROOM_ARCHIVED',
        'USER_KICKED',
        'NOT_A_MEMBER',
        'FORBIDDEN',
        'INVALID_INPUT',
        'POLL_LOCKED',
        'POLL_EXPIRED',
        'ITEM_NOT_FOUND',
        'LOG_ALREADY_RESTORED',
        'MAX_IMAGES_EXCEEDED',
      ];
      for (const token of expectedTokens) {
        expect(sql).toContain(token);
      }
    });

    it('sets transaction-local app.poproom_rpc flag in guarded RPCs and logs kicked member nickname (Important #3 & #4)', () => {
      const sql = stripSqlComments(readSql(RPCS_SQL_PATH));

      for (const rpc of [
        'reset_room_code',
        'archive_room',
        'soft_delete_block_item',
        'restore_deleted_item',
      ]) {
        const body = extractFunctionBody(sql, rpc);
        expect(body).toMatch(
          /PERFORM\s+set_config\s*\(\s*'app\.poproom_rpc'\s*,\s*'1'\s*,\s*true\s*\)/i,
        );
      }

      const kickBody = extractFunctionBody(sql, 'kick_room_member');
      expect(kickBody).toMatch(/SELECT\s+nickname\s+INTO\s+\w+\s+FROM\s+(?:public\.)?profiles/i);
      expect(kickBody).toMatch(
        /to_jsonb\s*\(\s*v_target\s*\)\s*\|\|\s*jsonb_build_object\s*\(\s*'nickname'\s*,/i,
      );
    });
  });

  describe('supabase/README.md', () => {
    it('documents sequential SQL setup, Email Confirm toggle, and .env configuration', () => {
      expect(existsSync(README_PATH)).toBe(true);
      const readme = readFileSync(README_PATH, 'utf8');
      expect(readme).toContain('001_initial_schema.sql');
      expect(readme).toContain('002_rls_policies.sql');
      expect(readme).toContain('003_rpcs.sql');
      expect(readme).toMatch(/Confirm Email/i);
      expect(readme).toContain('EXPO_PUBLIC_SUPABASE_URL');
      expect(readme).toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    });
  });
});
