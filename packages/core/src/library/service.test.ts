import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase } from '../store/db.ts';
import { indexTurnProse } from '../store/prose-index.ts';
import { createLibraryService, workLabel } from './service.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

const workId = '00000000-0000-4000-8000-000000000001';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const bus = createEventBus();
  const service = createLibraryService({
    dataDir: temp.dir,
    db: opened.db,
    bus,
    logger,
    shutdown: new AbortController().signal,
  });
  return { temp, opened, service, bus };
}

describe('workLabel', () => {
  it('有标题用标题，没有标题取背景第一行', () => {
    expect(workLabel('雨夜', '背景')).toBe('雨夜');
    expect(workLabel(null, '\n  第一行  \n第二行')).toBe('第一行');
    expect(workLabel(null, '')).toBe('');
    expect(Array.from(workLabel(null, '一'.repeat(50)))).toHaveLength(40);
  });
});

describe('createLibraryService', () => {
  it('新建草稿、保存背景并区分修订号', () => {
    const { temp, opened, service } = setup();
    try {
      const created = service.create({ workId });
      expect(created.draft).toEqual({ contentRev: 0, background: '' });
      const saved = service.saveBackground({ workId, baseContentRev: 0, background: '雨夜修钟铺' });
      expect(saved.contentRev).toBe(1);
      expect(service.get({ workId }).draft.background).toBe('雨夜修钟铺');
      expect(service.saveBackground({ workId, baseContentRev: 1, background: '雨夜修钟铺' }).contentRev).toBe(1);
      expect(() => service.saveBackground({ workId, baseContentRev: 0, background: '另一个' })).toThrow();
      expect(service.saveBackground({ workId, baseContentRev: 1, background: '另一个' }).contentRev).toBe(2);
      expect(service.create({ workId }).draft.contentRev).toBe(2);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('列表按更新时间倒序，未发布为草稿', () => {
    const { temp, opened, service } = setup();
    try {
      const first = '00000000-0000-4000-8000-000000000001';
      const second = '00000000-0000-4000-8000-000000000002';
      service.create({ workId: first });
      service.create({ workId: second });
      service.saveBackground({ workId: second, baseContentRev: 0, background: '第二部' });
      const list = service.list();
      expect(list[0]?.id).toBe(second);
      expect(list[0]?.status).toBe('draft');
      expect(list[0]?.label).toBe('第二部');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('删除作品级联清掉进度、事实和全文索引', async () => {
    const { temp, opened, service, bus } = setup();
    const events: string[] = [];
    const abort = new AbortController();
    const collecting = (async () => {
      for await (const event of bus.subscribe(abort.signal)) events.push(event.type);
    })();
    try {
      service.create({ workId });
      await new Promise((resolve) => setTimeout(resolve, 0));
      events.length = 0;
      const publishedId = '00000000-0000-4000-8000-000000000002';
      const playthroughId = '00000000-0000-4000-8000-000000000003';
      const turnId = '00000000-0000-4000-8000-000000000004';
      const now = Date.now();
      opened.db.run(sql`update works set published_id = ${publishedId} where id = ${workId}`);
      opened.db.run(
        sql`insert into work_versions (id, work_id, kind, content_rev, meta, created_at, updated_at)
            values (${publishedId}, ${workId}, 'published', 1, '{"background":""}', ${now}, ${now})`,
      );
      opened.db.run(
        sql`insert into playthroughs (id, version_id, kind, root_turn_id, created_at)
            values (${playthroughId}, ${publishedId}, 'play', ${turnId}, ${now})`,
      );
      opened.db.run(
        sql`insert into turns (id, playthrough_id, depth, prose, options, scene, status, created_at)
            values (${turnId}, ${playthroughId}, 0, '灯塔守夜人在渡口等船', '[]',
                    '{"place":"渡口","time":"夜里","present":[]}', 'committed', ${now})`,
      );
      opened.db.run(
        sql`insert into entities (version_id, id, kind, name, profile, is_protagonist)
            values (${publishedId}, 'p1', 'character', '主角', '{"text":""}', 1)`,
      );
      opened.db.run(
        sql`insert into llm_calls (id, purpose, work_id, provider, model, status, created_at)
            values ('call', 'narrator', ${workId}, 'p', 'm', 'ok', ${now})`,
      );
      indexTurnProse(opened.db, turnId, '灯塔守夜人在渡口等船');
      expect(opened.db.all(sql`select * from works where id = ${workId}`)).toHaveLength(1);
      expect(opened.db.all(sql`select * from prose_fts where turn_id = ${turnId}`)).toHaveLength(1);

      service.delete({ workId });
      expect(opened.db.all(sql`select * from works where id = ${workId}`)).toHaveLength(0);
      expect(opened.db.all(sql`select * from work_versions where work_id = ${workId}`)).toHaveLength(0);
      expect(opened.db.all(sql`select * from turns where playthrough_id = ${playthroughId}`)).toHaveLength(0);
      expect(opened.db.all(sql`select * from entities where version_id = ${publishedId}`)).toHaveLength(0);
      expect(opened.db.all(sql`select * from prose_fts where turn_id = ${turnId}`)).toHaveLength(0);
      const calls = opened.db.all<{ work_id: string | null }>(sql`select work_id from llm_calls where id = 'call'`);
      expect(calls).toEqual([{ work_id: null }]);

      service.delete({ workId });
      await new Promise((resolve) => setTimeout(resolve, 0));
      abort.abort();
      await collecting;
      expect(events.filter((type) => type === 'works.changed')).toHaveLength(1);
    } finally {
      abort.abort();
      opened.close();
      temp.cleanup();
    }
  });
});
