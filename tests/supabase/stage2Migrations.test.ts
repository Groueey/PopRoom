import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = path.resolve(__dirname, '../..');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'supabase', 'migrations');
const STAGE2_SCHEMA_SQL_PATH = path.join(MIGRATIONS_DIR, '004_stage2_chat_and_compliance.sql');
const STAGE2_RPCS_SQL_PATH = path.join(MIGRATIONS_DIR, '005_stage2_rpcs_and_auto_archive.sql');
const README_EN_PATH = path.join(ROOT_DIR, 'supabase', 'README.md');
const README_ZH_PATH = path.join(ROOT_DIR, 'supabase', 'README.zh.md');

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

describe('Stage 2 Supabase migration contracts', () => {
  describe('004_stage2_chat_and_compliance.sql', () => {
    it('defines all 4 Stage 2 tables with required columns, constraints, and indexes', () => {
      expect(existsSync(STAGE2_SCHEMA_SQL_PATH)).toBe(true);
      const sql = stripSqlComments(readSql(STAGE2_SCHEMA_SQL_PATH));

      const expectedTables = [
        'room_messages',
        'message_reports',
        'user_blocks',
        'room_chat_reads',
      ];
      for (const table of expectedTables) {
        expect(sql).toMatch(
          new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\b`, 'i'),
        );
      }

      // room_messages constraints
      expect(sql).toMatch(/msg_type[\s\S]*?'text'[\s\S]*?'block_card'[\s\S]*?'system'/i);
      expect(sql).toMatch(/char_length\s*\(\s*btrim\s*\(\s*content\s*\)\s*\)\s+BETWEEN\s+1\s+AND\s+1000/i);
      expect(sql).toMatch(/metadata\s+JSONB\s+NOT\s+NULL\s+DEFAULT\s+'\{\}'::jsonb/i);
      expect(sql).toMatch(/is_deleted\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+FALSE/i);

      // message_reports constraints
      expect(sql).toMatch(/char_length\s*\(\s*btrim\s*\(\s*reason\s*\)\s*\)\s+BETWEEN\s+1\s+AND\s+300/i);
      expect(sql).toMatch(/UNIQUE\s*\(\s*message_id\s*,\s*reporter_id\s*\)/i);

      // user_blocks constraints
      expect(sql).toMatch(/PRIMARY\s+KEY\s*\(\s*blocker_id\s*,\s*blocked_id\s*\)/i);
      expect(sql).toMatch(/CHECK\s*\(\s*blocker_id\s*<>\s*blocked_id\s*\)/i);

      // room_chat_reads constraints
      expect(sql).toMatch(/PRIMARY\s+KEY\s*\(\s*room_id\s*,\s*user_id\s*\)/i);
      expect(sql).toMatch(/last_read_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/i);

      // Required indexes
      expect(sql).toMatch(
        /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_room_messages_room\s+ON\s+(?:public\.)?room_messages\s*\(\s*room_id\s*,\s*created_at\s+DESC\s*\)\s+WHERE\s+is_deleted\s*=\s*FALSE/i,
      );
      expect(sql).toMatch(
        /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_message_reports_room\s+ON\s+(?:public\.)?message_reports\s*\(\s*room_id\s*,\s*created_at\s+DESC\s*\)/i,
      );
      expect(sql).toMatch(
        /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_user_blocks_blocker\s+ON\s+(?:public\.)?user_blocks\s*\(\s*blocker_id\s*\)/i,
      );
    });

    it('extends activity_logs action constraint with delete_message and leave_room via DO block', () => {
      const sql = stripSqlComments(readSql(STAGE2_SCHEMA_SQL_PATH));

      expect(sql).toMatch(/DO\s+\$\$[\s\S]*?activity_logs[\s\S]*?DROP\s+CONSTRAINT[\s\S]*?activity_logs_action_check[\s\S]*?\$\$/i);
      expect(sql).toMatch(
        /activity_logs_action_check\s+CHECK\s*\(\s*action\s+IN\s*\([\s\S]*?'delete_item'[\s\S]*?'restore_item'[\s\S]*?'update_room'[\s\S]*?'kick_member'[\s\S]*?'delete_message'[\s\S]*?'leave_room'[\s\S]*?\)\s*\)/i,
      );
    });

    it('adds room_messages to supabase_realtime with REPLICA IDENTITY FULL and never includes poll_votes', () => {
      const sql = stripSqlComments(readSql(STAGE2_SCHEMA_SQL_PATH));

      expect(sql).toMatch(/ALTER\s+TABLE\s+(?:public\.)?room_messages\s+REPLICA\s+IDENTITY\s+FULL/i);
      const pubMatches = sql.match(/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+[\s\S]*?;/gi);
      expect(pubMatches).not.toBeNull();
      const pubStatement = (pubMatches ?? []).join(' ');
      expect(pubStatement).toMatch(/\broom_messages\b/i);
      expect(pubStatement).not.toMatch(/\bpoll_votes\b/i);
    });

    it('enables RLS on all 4 tables and enforces blocked-sender filtering and RPC-only write boundaries (Review Focus #1)', () => {
      const sql = stripSqlComments(readSql(STAGE2_SCHEMA_SQL_PATH));

      for (const table of ['room_messages', 'message_reports', 'user_blocks', 'room_chat_reads']) {
        expect(sql).toMatch(
          new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'),
        );
      }

      // room_messages: SELECT filters active member, is_deleted = FALSE, and user_blocks; no direct writes
      const msgSelect = sql.match(
        /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?room_messages\s+FOR\s+SELECT\b[\s\S]*?;/i,
      );
      expect(msgSelect).not.toBeNull();
      const msgSelectSql = msgSelect?.[0] ?? '';
      expect(msgSelectSql).toMatch(/is_active_member\s*\(\s*room_id\s*\)/i);
      expect(msgSelectSql).toMatch(/is_deleted\s*=\s*FALSE/i);
      expect(msgSelectSql).toMatch(
        /NOT\s+EXISTS\s*\([\s\S]*?FROM\s+(?:public\.)?user_blocks[\s\S]*?blocker_id\s*=\s*auth\.uid\(\)[\s\S]*?blocked_id\s*=\s*room_messages\.sender_id/i,
      );
      expect(sql).not.toMatch(/ON\s+(?:public\.)?room_messages\s+FOR\s+(INSERT|UPDATE|DELETE)\b/i);

      // message_reports: SELECT own reports only; no direct writes
      const reportSelect = sql.match(
        /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?message_reports\s+FOR\s+SELECT\b[\s\S]*?;/i,
      );
      expect(reportSelect).not.toBeNull();
      expect(reportSelect?.[0]).toMatch(/reporter_id\s*=\s*auth\.uid\(\)/i);
      expect(sql).not.toMatch(/ON\s+(?:public\.)?message_reports\s+FOR\s+(INSERT|UPDATE|DELETE)\b/i);

      // user_blocks: SELECT, INSERT (with blocked_id <> auth.uid()), DELETE scoped to blocker_id = auth.uid()
      const blockSelect = sql.match(
        /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?user_blocks\s+FOR\s+SELECT\b[\s\S]*?;/i,
      );
      const blockInsert = sql.match(
        /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?user_blocks\s+FOR\s+INSERT\b[\s\S]*?;/i,
      );
      const blockDelete = sql.match(
        /CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?user_blocks\s+FOR\s+DELETE\b[\s\S]*?;/i,
      );
      expect(blockSelect?.[0]).toMatch(/blocker_id\s*=\s*auth\.uid\(\)/i);
      expect(blockInsert?.[0]).toMatch(/blocker_id\s*=\s*auth\.uid\(\)/i);
      expect(blockInsert?.[0]).toMatch(/blocked_id\s*<>\s*auth\.uid\(\)/i);
      expect(blockDelete?.[0]).toMatch(/blocker_id\s*=\s*auth\.uid\(\)/i);

      // Must NOT widen public.profiles RLS via user_blocks
      expect(sql).not.toMatch(/CREATE\s+POLICY\s+\S+\s+ON\s+(?:public\.)?profiles\b/i);

      // room_chat_reads: SELECT, INSERT, UPDATE scoped to user_id = auth.uid() AND is_active_member(room_id)
      for (const op of ['SELECT', 'INSERT', 'UPDATE'] as const) {
        const policy = sql.match(
          new RegExp(`CREATE\\s+POLICY\\s+\\S+\\s+ON\\s+(?:public\\.)?room_chat_reads\\s+FOR\\s+${op}\\b[\\s\\S]*?;`, 'i'),
        );
        expect(policy).not.toBeNull();
        expect(policy?.[0]).toMatch(/user_id\s*=\s*auth\.uid\(\)/i);
        expect(policy?.[0]).toMatch(/is_active_member\s*\(\s*room_id\s*\)/i);
      }

      // Unlocks chat_enabled in prevent_room_immutable_update while keeping other guarded columns protected
      const roomImmutableFn = extractFunctionBody(sql, 'prevent_room_immutable_update');
      expect(roomImmutableFn).toMatch(/SET\s+search_path\s*=\s*public\b/i);
      expect(roomImmutableFn).toMatch(/NEW\.template_type\s+IS\s+DISTINCT\s+FROM\s+OLD\.template_type/i);
      expect(roomImmutableFn).toMatch(/NEW\.created_by\s+IS\s+DISTINCT\s+FROM\s+OLD\.created_by/i);
      expect(roomImmutableFn).toMatch(/NEW\.room_code\s+IS\s+DISTINCT\s+FROM\s+OLD\.room_code/i);
      expect(roomImmutableFn).toMatch(/NEW\.status\s+IS\s+DISTINCT\s+FROM\s+OLD\.status/i);
      expect(roomImmutableFn).toMatch(/NEW\.archived_at\s+IS\s+DISTINCT\s+FROM\s+OLD\.archived_at/i);
      expect(roomImmutableFn).not.toMatch(/NEW\.chat_enabled\s+IS\s+DISTINCT\s+FROM\s+OLD\.chat_enabled/i);
    });
  });

  describe('005_stage2_rpcs_and_auto_archive.sql', () => {
    const ALL_7_STAGE2_RPCS = [
      'create_room_with_template',
      'send_room_message',
      'soft_delete_room_message',
      'report_room_message',
      'reorder_room_blocks',
      'leave_room',
      'auto_archive_expired_rooms',
    ] as const;

    it('drops 6-arg create_room_with_template before defining all 7 SECURITY DEFINER RPCs with exact signatures & privileges', () => {
      expect(existsSync(STAGE2_RPCS_SQL_PATH)).toBe(true);
      const sql = stripSqlComments(readSql(STAGE2_RPCS_SQL_PATH));

      // Binding Pre-Flight Ruling: explicit DROP FUNCTION before 7-arg create_room_with_template
      const dropMatch = sql.match(
        /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.create_room_with_template\s*\(\s*TEXT\s*,\s*TEXT\s*,\s*TEXT\s*,\s*TEXT\s*,\s*TIMESTAMPTZ\s*,\s*TIMESTAMPTZ\s*\)\s*;/i,
      );
      expect(dropMatch).not.toBeNull();
      const createIdx = sql.search(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.create_room_with_template\b/i,
      );
      expect(dropMatch?.index ?? -1).toBeLessThan(createIdx);

      for (const rpc of ALL_7_STAGE2_RPCS) {
        const body = extractFunctionBody(sql, rpc);
        expect(body).toMatch(/SECURITY\s+DEFINER/i);
        expect(body).toMatch(/SET\s+search_path\s*=\s*public\b/i);
      }

      // Exact parameter signatures & return types
      const createRoom = extractFunctionBody(sql, 'create_room_with_template');
      expect(createRoom).toMatch(
        /p_title\s+TEXT[\s\S]*?p_template_type\s+TEXT[\s\S]*?p_join_mode\s+TEXT[\s\S]*?p_announcement\s+TEXT\s+DEFAULT\s+''[\s\S]*?p_event_start_at\s+TIMESTAMPTZ\s+DEFAULT\s+NULL[\s\S]*?p_event_end_at\s+TIMESTAMPTZ\s+DEFAULT\s+NULL[\s\S]*?p_chat_enabled\s+BOOLEAN\s+DEFAULT\s+NULL[\s\S]*?RETURNS\s+(?:public\.)?rooms/i,
      );
      expect(createRoom).toMatch(
        /COALESCE\s*\(\s*p_chat_enabled\s*,\s*p_template_type\s+IN\s*\(\s*'campus'\s*,\s*'travel'\s*\)\s*\)/i,
      );

      expect(extractFunctionBody(sql, 'send_room_message')).toMatch(
        /p_room_id\s+UUID[\s\S]*?p_msg_type\s+TEXT[\s\S]*?p_content\s+TEXT[\s\S]*?p_metadata\s+JSONB\s+DEFAULT\s+'\{\}'::jsonb[\s\S]*?RETURNS\s+(?:public\.)?room_messages/i,
      );
      expect(extractFunctionBody(sql, 'soft_delete_room_message')).toMatch(
        /p_message_id\s+UUID[\s\S]*?RETURNS\s+(?:public\.)?room_messages/i,
      );
      expect(extractFunctionBody(sql, 'report_room_message')).toMatch(
        /p_message_id\s+UUID[\s\S]*?p_reason\s+TEXT[\s\S]*?RETURNS\s+(?:public\.)?message_reports/i,
      );
      expect(extractFunctionBody(sql, 'reorder_room_blocks')).toMatch(
        /p_room_id\s+UUID[\s\S]*?p_block_ids\s+UUID\[\][\s\S]*?RETURNS\s+VOID/i,
      );
      expect(extractFunctionBody(sql, 'leave_room')).toMatch(
        /p_room_id\s+UUID[\s\S]*?RETURNS\s+VOID/i,
      );
      expect(extractFunctionBody(sql, 'auto_archive_expired_rooms')).toMatch(
        /auto_archive_expired_rooms\s*\(\s*\)[\s\S]*?RETURNS\s+INT/i,
      );

      // Privilege hardening: 6 user RPCs granted to authenticated & service_role; auto_archive restricted to service_role
      const userRpcSignatures = [
        'create_room_with_template\\s*\\(\\s*TEXT\\s*,\\s*TEXT\\s*,\\s*TEXT\\s*,\\s*TEXT\\s*,\\s*TIMESTAMPTZ\\s*,\\s*TIMESTAMPTZ\\s*,\\s*BOOLEAN\\s*\\)',
        'send_room_message\\s*\\(\\s*UUID\\s*,\\s*TEXT\\s*,\\s*TEXT\\s*,\\s*JSONB\\s*\\)',
        'soft_delete_room_message\\s*\\(\\s*UUID\\s*\\)',
        'report_room_message\\s*\\(\\s*UUID\\s*,\\s*TEXT\\s*\\)',
        'reorder_room_blocks\\s*\\(\\s*UUID\\s*,\\s*UUID\\[\\]\\s*\\)',
        'leave_room\\s*\\(\\s*UUID\\s*\\)',
      ];
      for (const sig of userRpcSignatures) {
        expect(sql).toMatch(
          new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+(?:public\\.)?${sig}\\s+FROM\\s+PUBLIC`, 'i'),
        );
        expect(sql).toMatch(
          new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+(?:public\\.)?${sig}\\s+TO\\s+authenticated\\s*,\\s*service_role`, 'i'),
        );
      }

      expect(sql).toMatch(
        /REVOKE\s+ALL\s+ON\s+FUNCTION\s+(?:public\.)?auto_archive_expired_rooms\s*\(\s*\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated\s*;/i,
      );
      expect(sql).toMatch(
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?auto_archive_expired_rooms\s*\(\s*\)\s+TO\s+service_role\s*;/i,
      );
      expect(sql).not.toMatch(
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?auto_archive_expired_rooms\s*\(\s*\)\s+TO\s+[^;]*(?:authenticated|anon)/i,
      );
    });

    it('enforces chat_enabled, ROOM_ARCHIVED, admin-only block_card/mentionAll, and read cursor upsert in send_room_message (Review Focus #2)', () => {
      const sql = stripSqlComments(readSql(STAGE2_RPCS_SQL_PATH));
      const body = extractFunctionBody(sql, 'send_room_message');

      expect(body).toContain('NOT_AUTHENTICATED');
      expect(body).toContain('NOT_A_MEMBER');
      expect(body).toContain('ROOM_ARCHIVED');
      expect(body).toContain('CHAT_DISABLED');
      expect(body).toContain('INVALID_INPUT');
      expect(body).toContain('FORBIDDEN');
      expect(body).toContain('ITEM_NOT_FOUND');
      expect(body).toMatch(/FROM\s+(?:public\.)?rooms[\s\S]*?FOR\s+SHARE/i);
      expect(body).toMatch(/is_active_member\s*\(\s*p_room_id\s*\)/i);
      expect(body).toMatch(/is_room_active\s*\(\s*p_room_id\s*\)/i);
      expect(body).toMatch(/chat_enabled/i);
      expect(body).toMatch(/p_msg_type\s+NOT\s+IN\s*\(\s*'text'\s*,\s*'block_card'\s*\)/i);
      expect(body).toMatch(/jsonb_typeof\s*\([\s\S]*?\)\s*<>\s*'object'/i);
      expect(body).toMatch(/linkedBlockId/i);
      expect(body).toMatch(/mentionAll/i);
      expect(body).toMatch(/is_room_admin\s*\(\s*p_room_id\s*\)/i);
      expect(body).toMatch(/INSERT\s+INTO\s+(?:public\.)?room_messages/i);
      expect(body).toMatch(/INSERT\s+INTO\s+(?:public\.)?room_chat_reads[\s\S]*?ON\s+CONFLICT/i);
    });

    it('enforces archive lock, sender/admin permission, and audit log in soft_delete_room_message', () => {
      const sql = stripSqlComments(readSql(STAGE2_RPCS_SQL_PATH));
      const body = extractFunctionBody(sql, 'soft_delete_room_message');

      expect(body).toContain('NOT_AUTHENTICATED');
      expect(body).toContain('ITEM_NOT_FOUND');
      expect(body).toContain('ROOM_ARCHIVED');
      expect(body).toContain('FORBIDDEN');
      expect(body).toMatch(/FROM\s+(?:public\.)?rooms[\s\S]*?FOR\s+SHARE/i);
      expect(body).toMatch(/is_room_active\s*\(/i);
      expect(body).toMatch(/sender_id\s*=\s*v_user_id/i);
      expect(body).toMatch(/is_room_admin\s*\(/i);
      expect(body).toMatch(/SET\s+is_deleted\s*=\s*TRUE/i);
      expect(body).toMatch(/INSERT\s+INTO\s+(?:public\.)?activity_logs/i);
      expect(body).toContain("'delete_message'");
      expect(body).toContain("'room_messages'");
      expect(body).toMatch(/to_jsonb\s*\(/i);
    });

    it('allows report_room_message in archived rooms while rejecting non-members and self-reports', () => {
      const sql = stripSqlComments(readSql(STAGE2_RPCS_SQL_PATH));
      const body = extractFunctionBody(sql, 'report_room_message');

      expect(body).toContain('NOT_AUTHENTICATED');
      expect(body).toContain('ITEM_NOT_FOUND');
      expect(body).toContain('NOT_A_MEMBER');
      expect(body).toContain('INVALID_INPUT');
      expect(body).toMatch(/is_active_member\s*\(/i);
      expect(body).toMatch(/sender_id\s*=\s*v_user_id/i);
      expect(body).toMatch(/INSERT\s+INTO\s+(?:public\.)?message_reports[\s\S]*?ON\s+CONFLICT\s*\(\s*message_id\s*,\s*reporter_id\s*\)/i);
      // Intentionally allowed when room is archived
      expect(body).not.toContain('ROOM_ARCHIVED');
      expect(body).not.toMatch(/is_room_active\s*\(/i);
    });

    it('enforces admin-only, archive lock, and exact block set validation in reorder_room_blocks', () => {
      const sql = stripSqlComments(readSql(STAGE2_RPCS_SQL_PATH));
      const body = extractFunctionBody(sql, 'reorder_room_blocks');

      expect(body).toContain('NOT_AUTHENTICATED');
      expect(body).toContain('FORBIDDEN');
      expect(body).toContain('ROOM_ARCHIVED');
      expect(body).toContain('INVALID_INPUT');
      expect(body).toMatch(/FROM\s+(?:public\.)?rooms[\s\S]*?FOR\s+SHARE/i);
      expect(body).toMatch(/is_room_admin\s*\(\s*p_room_id\s*\)/i);
      expect(body).toMatch(/is_room_active\s*\(\s*p_room_id\s*\)/i);
      expect(body).toMatch(/COUNT\s*\(\s*DISTINCT\b/i);
      expect(body).toMatch(/WITH\s+ORDINALITY/i);
      expect(body).toMatch(/UPDATE\s+(?:public\.)?blocks[\s\S]*?SET\s+sort_order/i);
    });

    it('enforces host protection, archive immutability, cursor cleanup, and audit log in leave_room (Review Focus #4)', () => {
      const sql = stripSqlComments(readSql(STAGE2_RPCS_SQL_PATH));
      const body = extractFunctionBody(sql, 'leave_room');

      expect(body).toContain('NOT_AUTHENTICATED');
      expect(body).toContain('ROOM_NOT_FOUND');
      expect(body).toContain('ROOM_ARCHIVED');
      expect(body).toContain('NOT_A_MEMBER');
      expect(body).toContain('HOST_CANNOT_LEAVE');
      expect(body).toMatch(/FROM\s+(?:public\.)?rooms[\s\S]*?FOR\s+SHARE/i);
      expect(body).toMatch(/is_room_active\s*\(\s*p_room_id\s*\)/i);
      expect(body).toMatch(/role\s*=\s*'host'/i);
      expect(body).toMatch(/DELETE\s+FROM\s+(?:public\.)?room_members/i);
      expect(body).toMatch(/DELETE\s+FROM\s+(?:public\.)?room_chat_reads/i);
      expect(body).toMatch(/INSERT\s+INTO\s+(?:public\.)?activity_logs/i);
      expect(body).toContain("'leave_room'");
      expect(body).toContain("'room_members'");
    });

    it('archives 7-day expired rooms with trusted RPC flag and schedules idempotent guarded pg_cron job', () => {
      const sql = stripSqlComments(readSql(STAGE2_RPCS_SQL_PATH));
      const body = extractFunctionBody(sql, 'auto_archive_expired_rooms');

      expect(body).toMatch(/PERFORM\s+set_config\s*\(\s*'app\.poproom_rpc'\s*,\s*'1'\s*,\s*true\s*\)/i);
      expect(body).toMatch(/status\s*=\s*'active'/i);
      expect(body).toMatch(/event_end_at\s+IS\s+NOT\s+NULL/i);
      expect(body).toMatch(/event_end_at\s*<=\s*NOW\(\)\s*-\s*INTERVAL\s+'7 days'/i);
      expect(body).toMatch(/SET\s+status\s*=\s*'archived'[\s\S]*?archived_at\s*=\s*NOW\(\)/i);
      expect(body).toMatch(/GET\s+DIAGNOSTICS/i);

      // Guarded pg_cron schedule block
      expect(sql).toMatch(/FROM\s+pg_extension[\s\S]*?extname\s*=\s*'pg_cron'/i);
      expect(sql).toMatch(/cron\.unschedule/i);
      expect(sql).toMatch(/cron\.schedule/i);
      expect(sql).toContain('poproom-auto-archive-daily');
      expect(sql).toContain('0 19 * * *');
    });
  });

  describe('Supabase setup documentation (EN & ZH)', () => {
    it('documents 004, 005, and pg_cron setup in both README.md and README.zh.md', () => {
      expect(existsSync(README_EN_PATH)).toBe(true);
      expect(existsSync(README_ZH_PATH)).toBe(true);

      const en = readFileSync(README_EN_PATH, 'utf8');
      const zh = readFileSync(README_ZH_PATH, 'utf8');

      for (const doc of [en, zh]) {
        expect(doc).toContain('004_stage2_chat_and_compliance.sql');
        expect(doc).toContain('005_stage2_rpcs_and_auto_archive.sql');
        expect(doc).toContain('pg_cron');
        expect(doc).toContain('001_initial_schema.sql');
        expect(doc).toContain('002_rls_policies.sql');
        expect(doc).toContain('003_rpcs.sql');
      }
    });
  });
});
