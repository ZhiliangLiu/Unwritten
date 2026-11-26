import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../events/bus.ts';
import type { LogEvent, Logger } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { seedStory } from '../test-support/story-fixtures.ts';
import { openDatabase } from '../store/db.ts';
import { createSummaryService } from './queue.ts';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const events: LogEvent[] = [];
  const logger: Logger = {
    record(event) {
      events.push(event);
    },
    sample() {},
    async flush() {},
    async close() {},
  };
  const llm = createScriptedLlm();
  const deps = {
    dataDir: temp.dir,
    db: opened.db,
    bus: createEventBus(),
    logger,
    shutdown: new AbortController().signal,
  };
  const summary = createSummaryService({ ...deps, llm });
  return { temp, opened, llm, summary, events };
}

describe('createSummaryService', () => {
  it('回合提交后写入摘要', async () => {
    const { temp, opened, llm, summary } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }, { prose: '第一回合', action: '推门' }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      llm.enqueue({ text: '主角推门进去。' });
      summary.enqueue(seeded.turnIds[1] ?? '', seeded.routeId);
      await summary.whenIdle();
      const rows = opened.db.all<{ summary: string }>(sql`select summary from turn_summaries`);
      expect(rows).toEqual([{ summary: '主角推门进去。' }]);
      expect(llm.completes[0]?.purpose).toBe('background');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('摘要里的换行被合并，超长被截断', async () => {
    const { temp, opened, llm, summary } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }, { prose: '第一回合', action: '推门' }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      llm.enqueue({ text: '第一行\n第二行\n第三行'.repeat(30) });
      summary.enqueue(seeded.turnIds[1] ?? '', seeded.routeId);
      await summary.whenIdle();
      const row = opened.db.get<{ summary: string }>(sql`select summary from turn_summaries`);
      expect(row?.summary).not.toContain('\n');
      expect(Array.from(row?.summary ?? '')).toHaveLength(200);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('后台模型未配置时记失败，不抛错', async () => {
    const { temp, opened, llm, summary, events } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }, { prose: '第一回合', action: '推门' }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      llm.setResolved(null);
      summary.enqueue(seeded.turnIds[1] ?? '', seeded.routeId);
      await summary.whenIdle();
      expect(opened.db.all(sql`select * from turn_summaries`)).toHaveLength(0);
      expect(events.some((event) => event.event === 'summary.failed')).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('回合在生成期间被删除时不写入', async () => {
    const { temp, opened, llm, summary } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }, { prose: '第一回合', action: '推门' }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      const turnId = seeded.turnIds[1] ?? '';
      llm.complete = async () => {
        opened.db.run(sql`delete from turns where id = ${turnId}`);
        return { text: '已经删掉了' };
      };
      summary.enqueue(turnId, seeded.routeId);
      await summary.whenIdle();
      expect(opened.db.all(sql`select * from turn_summaries`)).toHaveLength(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场回合不写摘要', async () => {
    const { temp, opened, llm, summary } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      llm.enqueue({ text: '不该出现' });
      summary.enqueue(seeded.turnIds[0] ?? '', seeded.routeId);
      await summary.whenIdle();
      expect(opened.db.all(sql`select * from turn_summaries`)).toHaveLength(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('启动补排只补最近活跃路线上缺摘要的回合', async () => {
    const { temp, opened, llm, summary } = setup();
    try {
      const recent = seedStory(opened.db, {
        turns: [{ prose: '开场' }, { prose: '第一回合', action: '一' }, { prose: '第二回合', action: '二' }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      const old = seedStory(opened.db, {
        turns: [{ prose: '开场' }, { prose: '旧回合', action: '旧' }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      opened.db.run(sql`update routes set updated_at = ${Date.now() - 10 * 86_400_000} where id = ${old.routeId}`);
      llm.enqueue({ text: '摘要一' }, { text: '摘要二' });
      expect(summary.backfill()).toBe(2);
      await summary.whenIdle();
      const rows = opened.db.all<{ turn_id: string }>(sql`select turn_id from turn_summaries order by turn_id`);
      expect(rows.map((row) => row.turn_id).sort()).toEqual(
        [recent.turnIds[1], recent.turnIds[2]].sort((left, right) => (left ?? '').localeCompare(right ?? '')),
      );
      expect(rows.some((row) => row.turn_id === old.turnIds[1])).toBe(false);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
