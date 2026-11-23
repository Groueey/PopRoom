import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = path.resolve(__dirname, '../..');
const MIGRATION_006 = path.join(
  ROOT_DIR,
  'supabase',
  'migrations',
  '006_announcement_acks.sql',
);

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('006_announcement_acks.sql migration contracts', () => {
  it('adds rooms.announcement_updated_at, version trigger, room_announcement_acks table, RLS, Realtime, and RPC', () => {
    const sql = stripSqlComments(readFileSync(MIGRATION_006, 'utf8'));

    expect(sql).toMatch(
      /ALTER\s+TABLE\s+public\.rooms\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+announcement_updated_at/i,
    );
    expect(sql).toMatch(/NEW\.announcement\s+IS\s+DISTINCT\s+FROM\s+OLD\.announcement/i);
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.room_announcement_acks/i);
    expect(sql).toMatch(/PRIMARY\s+KEY\s*\(\s*room_id\s*,\s*user_id\s*\)/i);
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+public\.room_announcement_acks\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
    expect(sql).toMatch(/is_active_member\s*\(\s*room_id\s*\)/i);
    expect(sql).toMatch(/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+public\.room_announcement_acks/i);
    expect(sql).not.toMatch(/ADD\s+TABLE[\s\S]*?\bpoll_votes\b/i);

    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.acknowledge_room_announcement/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(sql).toMatch(/ROOM_ARCHIVED/);
    expect(sql).toMatch(/NOT_A_MEMBER/);
    expect(sql).toMatch(/INVALID_INPUT/);
    expect(sql).toMatch(/NOTIFY\s+pgrst\s*,\s*'reload schema'/i);
  });
});
