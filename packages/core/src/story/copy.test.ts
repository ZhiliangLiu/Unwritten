import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase, type OpenedDatabase } from '../store/db.ts';
import { clearAuthorSetting, copyAuthorSetting } from './copy.ts';

const workId = '00000000-0000-4000-8000-000000000101';
const fromVersionId = '00000000-0000-4000-8000-000000000102';
const toVersionId = '00000000-0000-4000-8000-000000000103';
const playthroughId = '00000000-0000-4000-8000-000000000104';
const turnId = '00000000-0000-4000-8000-000000000105';
const authorEntityId = '00000000-0000-4000-8000-000000000106';
const playEntityId = '00000000-0000-4000-8000-000000000107';
const authorFactId = '00000000-0000-4000-8000-000000000108';
const playFactId = '00000000-0000-4000-8000-000000000109';
const authorStateId = '00000000-0000-4000-8000-000000000110';
const playStateId = '00000000-0000-4000-8000-000000000111';

function seed(opened: OpenedDatabase): void {
  const now = Date.now();
  opened.db.run(
    sql`insert into works (id, draft_id, created_at, updated_at) values (${workId}, ${fromVersionId}, ${now}, ${now})`,
  );
  for (const [versionId, kind] of [
    [fromVersionId, 'draft'],
    [toVersionId, 'published'],
  ] as const) {
    opened.db.run(
      sql`insert into work_versions (id, work_id, kind, content_rev, meta, created_at, updated_at)
          values (${versionId}, ${workId}, ${kind}, 0, '{"background":""}', ${now}, ${now})`,
    );
  }
  opened.db.run(
    sql`insert into playthroughs (id, version_id, kind, created_at)
        values (${playthroughId}, ${fromVersionId}, 'play', ${now})`,
  );
  opened.db.run(
    sql`insert into turns (id, playthrough_id, depth, prose, options, scene, status, created_at)
        values (${turnId}, ${playthroughId}, 0, '灯在渡口亮着', '[]',
                '{"place":"渡口","time":"夜里","present":[]}', 'committed', ${now})`,
  );

  opened.db.run(
    sql`insert into entities (version_id, id, kind, name, profile, is_protagonist, origin_turn_id)
        values (${fromVersionId}, ${authorEntityId}, 'character', '守夜人', '{"text":""}', 0, null)`,
  );
  opened.db.run(
    sql`insert into entities (version_id, id, kind, name, profile, is_protagonist, origin_turn_id)
        values (${fromVersionId}, ${playEntityId}, 'character', '提灯人', '{"text":""}', 0, ${turnId})`,
  );

  opened.db.run(
    sql`insert into entity_names (version_id, entity_id, name, holder_id, origin_turn_id, source_para)
        values (${fromVersionId}, ${authorEntityId}, '守夜人', null, null, null)`,
  );
  opened.db.run(
    sql`insert into entity_names (version_id, entity_id, name, holder_id, origin_turn_id, source_para)
        values (${fromVersionId}, ${playEntityId}, '提灯人', null, ${turnId}, 1)`,
  );

  opened.db.run(
    sql`insert into facts (version_id, id, origin_turn_id, source_para, kind, subject_id, statement, data)
        values (${fromVersionId}, ${authorFactId}, null, null, 'secret', ${authorEntityId}, '灯下有一封旧信',
                '{"title":"旧信","reveal":"灯灭时"}')`,
  );
  opened.db.run(
    sql`insert into facts (version_id, id, origin_turn_id, source_para, kind, subject_id, statement)
        values (${fromVersionId}, ${playFactId}, ${turnId}, 1, 'event', ${playEntityId}, '提灯人走进渡口')`,
  );

  opened.db.run(
    sql`insert into knowledge (version_id, fact_id, holder_id, level, origin_turn_id)
        values (${fromVersionId}, ${authorFactId}, ${authorEntityId}, 'confirmed', null)`,
  );
  opened.db.run(
    sql`insert into knowledge (version_id, fact_id, holder_id, level, origin_turn_id, source_para)
        values (${fromVersionId}, ${playFactId}, ${playEntityId}, 'confirmed', ${turnId}, 1)`,
  );

  opened.db.run(
    sql`insert into state_defs (version_id, id, key, label, display, config, hidden, origin_turn_id)
        values (${fromVersionId}, ${authorStateId}, 'night', '夜色', 'number',
                '{"min":0,"max":10,"unit":null,"stages":[]}', 0, null)`,
  );
  opened.db.run(
    sql`insert into state_defs (version_id, id, key, label, display, config, hidden, origin_turn_id)
        values (${fromVersionId}, ${playStateId}, 'night', '夜色', 'number',
                '{"min":0,"max":10,"unit":null,"stages":[]}', 0, ${turnId})`,
  );
}

describe('copyAuthorSetting', () => {
  it('只复制作者设定的行，游玩产生的行留在源版本', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      seed(opened);
      copyAuthorSetting(opened.db, { fromVersionId, toVersionId });

      const entityIds = opened.db
        .all<{ id: string }>(sql`select id from entities where version_id = ${toVersionId}`)
        .map((row) => row.id);
      expect(entityIds).toEqual([authorEntityId]);
      const sourceEntityIds = opened.db
        .all<{ id: string }>(sql`select id from entities where version_id = ${fromVersionId}`)
        .map((row) => row.id);
      expect(sourceEntityIds.sort()).toEqual([authorEntityId, playEntityId].sort());

      const nameIds = opened.db
        .all<{ entity_id: string }>(sql`select entity_id from entity_names where version_id = ${toVersionId}`)
        .map((row) => row.entity_id);
      expect(nameIds).toEqual([authorEntityId]);
      expect(opened.db.all(sql`select entity_id from entity_names where version_id = ${fromVersionId}`)).toHaveLength(
        2,
      );

      const factIds = opened.db
        .all<{ id: string }>(sql`select id from facts where version_id = ${toVersionId}`)
        .map((row) => row.id);
      expect(factIds).toEqual([authorFactId]);
      expect(opened.db.all(sql`select id from facts where version_id = ${fromVersionId}`)).toHaveLength(2);

      const knowledgeFactIds = opened.db
        .all<{ fact_id: string }>(sql`select fact_id from knowledge where version_id = ${toVersionId}`)
        .map((row) => row.fact_id);
      expect(knowledgeFactIds).toEqual([authorFactId]);
      expect(opened.db.all(sql`select fact_id from knowledge where version_id = ${fromVersionId}`)).toHaveLength(2);

      const stateRows = opened.db.all<{ id: string; key: string }>(
        sql`select id, key from state_defs where version_id = ${toVersionId}`,
      );
      expect(stateRows).toEqual([{ id: authorStateId, key: 'night' }]);
      expect(opened.db.all(sql`select id from state_defs where version_id = ${fromVersionId}`)).toHaveLength(2);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});

describe('clearAuthorSetting', () => {
  it('只清掉作者设定的行，游玩产生的行还在', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      seed(opened);
      clearAuthorSetting(opened.db, fromVersionId);

      const entityIds = opened.db
        .all<{ id: string }>(sql`select id from entities where version_id = ${fromVersionId}`)
        .map((row) => row.id);
      expect(entityIds).toEqual([playEntityId]);
      const nameEntityIds = opened.db
        .all<{ entity_id: string }>(sql`select entity_id from entity_names where version_id = ${fromVersionId}`)
        .map((row) => row.entity_id);
      expect(nameEntityIds).toEqual([playEntityId]);
      const factIds = opened.db
        .all<{ id: string }>(sql`select id from facts where version_id = ${fromVersionId}`)
        .map((row) => row.id);
      expect(factIds).toEqual([playFactId]);
      const knowledgeFactIds = opened.db
        .all<{ fact_id: string }>(sql`select fact_id from knowledge where version_id = ${fromVersionId}`)
        .map((row) => row.fact_id);
      expect(knowledgeFactIds).toEqual([playFactId]);
      const stateIds = opened.db
        .all<{ id: string }>(sql`select id from state_defs where version_id = ${fromVersionId}`)
        .map((row) => row.id);
      expect(stateIds).toEqual([playStateId]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
