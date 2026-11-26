import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase } from './db.ts';

const workOne = '00000000-0000-4000-8000-000000000101';
const draftOne = '00000000-0000-4000-8000-000000000102';
const publishedOne = '00000000-0000-4000-8000-000000000103';
const playthroughOne = '00000000-0000-4000-8000-000000000104';
const rootTurn = '00000000-0000-4000-8000-000000000105';
const nextTurn = '00000000-0000-4000-8000-000000000106';
const routeOne = '00000000-0000-4000-8000-000000000107';
const workTwo = '00000000-0000-4000-8000-000000000201';
const draftTwo = '00000000-0000-4000-8000-000000000202';

function seedLegacyLibrary(file: string): void {
  const opened = openDatabase(file);
  const now = Date.now();
  opened.db.run(
    sql`insert into works (id, title, draft_id, published_id, created_at, updated_at)
        values (${workOne}, '北岬', ${draftOne}, ${publishedOne}, ${now}, ${now})`,
  );
  opened.db.run(
    sql`insert into work_versions (id, work_id, kind, content_rev, source_rev, meta, created_at, updated_at)
        values (${draftOne}, ${workOne}, 'draft', 1, null, '{"background":""}', ${now}, ${now})`,
  );
  opened.db.run(
    sql`insert into work_versions (id, work_id, kind, content_rev, source_rev, meta, created_at, updated_at)
        values (${publishedOne}, ${workOne}, 'published', 1, 1, '{"background":""}', ${now}, ${now})`,
  );
  opened.db.run(
    sql`insert into works (id, title, draft_id, published_id, created_at, updated_at)
        values (${workTwo}, '雪原', ${draftTwo}, null, ${now}, ${now})`,
  );
  opened.db.run(
    sql`insert into work_versions (id, work_id, kind, content_rev, source_rev, meta, created_at, updated_at)
        values (${draftTwo}, ${workTwo}, 'draft', 0, null, '{"background":""}', ${now}, ${now})`,
  );
  opened.db.run(
    sql`insert into playthroughs (id, version_id, kind, root_turn_id, created_at)
        values (${playthroughOne}, ${publishedOne}, 'play', ${rootTurn}, ${now})`,
  );
  opened.db.run(
    sql`insert into turns (id, playthrough_id, depth, prose, options, scene, status, created_at)
        values (${rootTurn}, ${playthroughOne}, 0, '灯塔守夜人在渡口等船', '[]',
                '{"place":"渡口","time":"夜里","present":[]}', 'committed', ${now})`,
  );
  opened.db.run(
    sql`insert into turns (id, playthrough_id, parent_id, depth, prose, options, scene, status, created_at)
        values (${nextTurn}, ${playthroughOne}, ${rootTurn}, 1, '雨停以后灯还亮着', '[]',
                '{"place":"渡口","time":"夜里","present":[]}', 'committed', ${now})`,
  );
  opened.db.run(
    sql`insert into routes (id, playthrough_id, head_turn_id, created_at, updated_at)
        values (${routeOne}, ${playthroughOne}, ${nextTurn}, ${now}, ${now})`,
  );
  opened.close();
}

describe('backfillStory', () => {
  it('为 M1 留下的作品补主角和全文索引', () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'library.db');
    try {
      seedLegacyLibrary(file);
      const opened = openDatabase(file);
      try {
        expect(opened.backfill).toEqual({ protagonists: 1, ftsTurns: 2 });
        const protagonists = opened.db.all<{ id: string; name: string }>(
          sql`select id, name from entities
              where version_id = ${publishedOne} and is_protagonist = 1`,
        );
        expect(protagonists).toHaveLength(1);
        expect(protagonists[0]?.name).toBe('主角');
        const names = opened.db.all<{ name: string }>(
          sql`select name from entity_names
              where version_id = ${publishedOne} and entity_id = ${protagonists[0]?.id} and holder_id = ${protagonists[0]?.id}`,
        );
        expect(names.map((row) => row.name)).toEqual(['主角']);
        expect(
          opened.db.all(sql`select * from entities where version_id = ${draftOne} and is_protagonist = 1`),
        ).toHaveLength(0);
        expect(
          opened.db.all(sql`select * from entities where version_id = ${draftTwo} and is_protagonist = 1`),
        ).toHaveLength(0);
        expect(opened.db.all(sql`select * from prose_fts where turn_id = ${rootTurn}`)).toHaveLength(1);
        expect(opened.db.all(sql`select * from prose_fts where turn_id = ${nextTurn}`)).toHaveLength(1);
      } finally {
        opened.close();
      }
      const reopened = openDatabase(file);
      try {
        expect(reopened.backfill).toEqual({ protagonists: 0, ftsTurns: 0 });
        expect(
          reopened.db.all(sql`select * from entities where version_id = ${publishedOne} and is_protagonist = 1`),
        ).toHaveLength(1);
      } finally {
        reopened.close();
      }
    } finally {
      temp.cleanup();
    }
  });
});
