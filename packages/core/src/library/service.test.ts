import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORK_SETTINGS, EMPTY_WORK_ANCHORS } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import type { LogEvent, Logger } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { indexTurnProse } from '../store/prose-index.ts';
import type { VersionMeta } from '../store/meta.ts';
import { createLibraryService, workLabel } from './service.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

const workId = '00000000-0000-4000-8000-000000000001';

function draft(contentRev: number, background: string, anchors: typeof EMPTY_WORK_ANCHORS) {
  return { contentRev, background, anchors, settings: DEFAULT_WORK_SETTINGS, wizardStep: 'background', plan: null };
}

function recordingLogger(): { logger: Logger; events: LogEvent[] } {
  const events: LogEvent[] = [];
  return {
    events,
    logger: {
      record(event) {
        events.push(event);
      },
      sample() {},
      async flush() {},
      async close() {},
    },
  };
}

function storedMeta(db: Database, id: string): VersionMeta {
  const row = db.get<{ meta: string }>(sql`select meta from work_versions where work_id = ${id} and kind = 'draft'`);
  return JSON.parse(row!.meta) as VersionMeta;
}

function publishWork(db: Database, id: string, publishedId: string) {
  const now = Date.now();
  db.run(sql`update works set published_id = ${publishedId} where id = ${id}`);
  db.run(
    sql`insert into work_versions (id, work_id, kind, content_rev, meta, created_at, updated_at)
        values (${publishedId}, ${id}, 'published', 1, '{"background":"雨夜修钟铺"}', ${now}, ${now})`,
  );
}

function addPlay(
  db: Database,
  input: { playthroughId: string; versionId: string; turnId: string; routeId: string; updatedAt: number },
) {
  db.run(
    sql`insert into playthroughs (id, version_id, kind, root_turn_id, created_at)
        values (${input.playthroughId}, ${input.versionId}, 'play', ${input.turnId}, ${input.updatedAt})`,
  );
  db.run(
    sql`insert into turns (id, playthrough_id, depth, prose, options, scene, status, created_at)
        values (${input.turnId}, ${input.playthroughId}, 0, '渡口的灯还亮着', '[]',
                '{"place":"渡口","time":"夜里","present":[]}', 'committed', ${input.updatedAt})`,
  );
  db.run(
    sql`insert into routes (id, playthrough_id, head_turn_id, created_at, updated_at)
        values (${input.routeId}, ${input.playthroughId}, ${input.turnId}, ${input.updatedAt}, ${input.updatedAt})`,
  );
}

function setup(options: { logger?: Logger } = {}) {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const bus = createEventBus();
  const service = createLibraryService({
    dataDir: temp.dir,
    db: opened.db,
    bus,
    logger: options.logger ?? logger,
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
      expect(created.draft).toEqual(draft(0, '', EMPTY_WORK_ANCHORS));
      const anchors = {
        narrationDirective: '用第二人称，句子短。',
        contentPolicy: '不写血腥场面。',
        improvisationScope: '路人的名字可以现造。',
      };
      const saved = service.saveDraft({
        workId,
        baseContentRev: 0,
        background: '雨夜修钟铺',
        anchors,
        settings: DEFAULT_WORK_SETTINGS,
      });
      expect(saved.contentRev).toBe(1);
      expect(service.get({ workId }).draft).toEqual(draft(1, '雨夜修钟铺', anchors));
      expect(
        service.saveDraft({
          workId,
          baseContentRev: 1,
          background: '雨夜修钟铺',
          anchors,
          settings: DEFAULT_WORK_SETTINGS,
        }).contentRev,
      ).toBe(1);
      expect(() =>
        service.saveDraft({ workId, baseContentRev: 0, background: '另一个', settings: DEFAULT_WORK_SETTINGS }),
      ).toThrow();
      expect(
        service.saveDraft({
          workId,
          baseContentRev: 1,
          background: '另一个',
          anchors,
          settings: DEFAULT_WORK_SETTINGS,
        }).contentRev,
      ).toBe(2);
      const edited = service.saveDraft({
        workId,
        baseContentRev: 2,
        background: '另一个',
        anchors: { ...anchors, contentPolicy: '不写血腥场面和对白里的脏话。' },
        settings: DEFAULT_WORK_SETTINGS,
      });
      expect(edited.contentRev).toBe(3);
      expect(service.create({ workId }).draft.contentRev).toBe(3);
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
      service.saveDraft({ workId: second, baseContentRev: 0, background: '第二部', settings: DEFAULT_WORK_SETTINGS });
      const list = service.list();
      expect(list[0]?.id).toBe(second);
      expect(list[0]?.status).toBe('draft');
      expect(list[0]?.label).toBe('第二部');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('保存补充设定只给改了的节加修订号', () => {
    const recorder = recordingLogger();
    const { temp, opened, service } = setup({ logger: recorder.logger });
    try {
      service.create({ workId });
      const first = service.saveDraft({
        workId,
        baseContentRev: 0,
        background: '雨夜修钟铺',
        settings: { ...DEFAULT_WORK_SETTINGS, world: { text: '雾港' } },
      });
      expect(first.contentRev).toBe(1);
      const second = service.saveDraft({
        workId,
        baseContentRev: 1,
        background: '雨夜修钟铺',
        settings: {
          ...DEFAULT_WORK_SETTINGS,
          world: { text: '雾港' },
          cast: { text: '', mode: 'per_run' },
        },
      });
      expect(second.contentRev).toBe(2);
      const meta = storedMeta(opened.db, workId);
      expect(meta.settings?.cast.rev).toBe(1);
      expect(meta.settings?.world.rev).toBe(1);
      expect(meta.settings?.secrets.rev).toBe(0);
      const saved = recorder.events.filter((event) => event.event === 'work.draft.saved');
      expect(saved.map((event) => event.data)).toEqual([
        { contentRev: 1, sections: ['world'] },
        { contentRev: 2, sections: ['cast'] },
      ]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('设定没变不加修订号', () => {
    const { temp, opened, service } = setup();
    try {
      service.create({ workId });
      const settings = { ...DEFAULT_WORK_SETTINGS, world: { text: '雾港' } };
      expect(service.saveDraft({ workId, baseContentRev: 0, background: '', settings }).contentRev).toBe(1);
      expect(service.saveDraft({ workId, baseContentRev: 1, background: '', settings }).contentRev).toBe(1);
      const meta = storedMeta(opened.db, workId);
      expect(meta.settings?.world).toEqual({ text: '雾港', rev: 1 });
      expect(meta.settings?.cast).toEqual({ text: '', mode: 'fixed', rev: 0 });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('切换向导步骤不改修订号', () => {
    const { temp, opened, service } = setup();
    try {
      service.create({ workId });
      const saved = service.saveDraft({
        workId,
        baseContentRev: 0,
        background: '雨夜修钟铺',
        settings: DEFAULT_WORK_SETTINGS,
      });
      const before = opened.db.get<{ updated_at: number }>(sql`select updated_at from works where id = ${workId}`);
      service.setWizardStep({ workId, step: 'plan' });
      const work = service.get({ workId });
      expect(work.draft.wizardStep).toBe('plan');
      expect(work.draft.contentRev).toBe(saved.contentRev);
      expect(storedMeta(opened.db, workId).wizardStep).toBe('plan');
      expect(
        opened.db.get<{ updated_at: number }>(sql`select updated_at from works where id = ${workId}`)?.updated_at,
      ).toBe(before?.updated_at);
      expect(service.setWizardStep({ workId, step: 'plan' })).toEqual({});
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('作品库卡片指向最近游玩的路线', () => {
    const { temp, opened, service } = setup();
    try {
      const otherWorkId = '00000000-0000-4000-8000-000000000002';
      service.create({ workId });
      service.create({ workId: otherWorkId });
      const publishedId = '00000000-0000-4000-8000-000000000010';
      const otherPublishedId = '00000000-0000-4000-8000-000000000020';
      publishWork(opened.db, workId, publishedId);
      publishWork(opened.db, otherWorkId, otherPublishedId);
      addPlay(opened.db, {
        playthroughId: '00000000-0000-4000-8000-000000000011',
        versionId: publishedId,
        turnId: '00000000-0000-4000-8000-000000000012',
        routeId: '00000000-0000-4000-8000-000000000013',
        updatedAt: 1_000,
      });
      addPlay(opened.db, {
        playthroughId: '00000000-0000-4000-8000-000000000014',
        versionId: publishedId,
        turnId: '00000000-0000-4000-8000-000000000015',
        routeId: '00000000-0000-4000-8000-000000000016',
        updatedAt: 2_000,
      });
      addPlay(opened.db, {
        playthroughId: '00000000-0000-4000-8000-000000000021',
        versionId: otherPublishedId,
        turnId: '00000000-0000-4000-8000-000000000022',
        routeId: '00000000-0000-4000-8000-000000000023',
        updatedAt: 3_000,
      });
      const summaries = service.list();
      expect(summaries.find((summary) => summary.id === workId)?.routeId).toBe('00000000-0000-4000-8000-000000000016');
      expect(summaries.find((summary) => summary.id === otherWorkId)?.routeId).toBe(
        '00000000-0000-4000-8000-000000000023',
      );
      expect(summaries.find((summary) => summary.id === workId)?.hasMultiplePlaythroughs).toBe(true);
      expect(summaries.find((summary) => summary.id === otherWorkId)?.hasMultiplePlaythroughs).toBe(false);
      expect(service.get({ workId }).routeCount).toBe(2);
      expect(service.get({ workId: otherWorkId }).routeCount).toBe(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('发布了但还没开局时没有路线', () => {
    const { temp, opened, service } = setup();
    try {
      service.create({ workId });
      publishWork(opened.db, workId, '00000000-0000-4000-8000-000000000010');
      const summary = service.list().find((item) => item.id === workId);
      expect(summary?.routeId).toBeNull();
      expect(summary?.hasProgress).toBe(false);
      expect(summary?.hasMultiplePlaythroughs).toBe(false);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('删除提交后通知清理，回调里查不到作品，重复删除不再通知', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    const onWorkDeleted = vi.fn(() => {
      expect(opened.db.all(sql`select 1 from works where id = ${workId}`)).toHaveLength(0);
    });
    const service = createLibraryService({
      dataDir: temp.dir,
      db: opened.db,
      bus: createEventBus(),
      logger,
      shutdown: new AbortController().signal,
      onWorkDeleted,
    });
    try {
      service.create({ workId });
      service.delete({ workId });
      expect(onWorkDeleted).toHaveBeenCalledTimes(1);
      service.delete({ workId });
      expect(onWorkDeleted).toHaveBeenCalledTimes(1);
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
