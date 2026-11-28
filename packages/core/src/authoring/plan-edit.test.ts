import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORK_SETTINGS } from '@unwritten/contracts';
import type { CastMode, PlanItem } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import type { Database } from '../store/db.ts';
import { openDatabase } from '../store/db.ts';
import { workVersions } from '../store/schema.ts';
import type { VersionMeta } from '../store/meta.ts';
import { readSettings } from '../store/plan.ts';
import { createLibraryService } from '../library/service.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createAuthoringService } from './service.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

const workId = '00000000-0000-4000-8000-000000000001';

const identity: PlanItem = {
  kind: 'summary',
  id: 'summary-identity',
  source: 'ai',
  key: 'identity',
  text: '刚到灯塔镇的邮差，谁也不认识',
};
const situation: PlanItem = {
  kind: 'summary',
  id: 'summary-situation',
  source: 'ai',
  key: 'situation',
  text: '最后一班船靠岸时，镇上停了电',
};
const protagonist: PlanItem = {
  kind: 'entity',
  id: 'entity-protagonist',
  source: 'ai',
  entityKind: 'character',
  role: 'protagonist',
  name: '新来的邮差',
  knownAs: null,
  profile: '二十多岁，记性好',
  appearance: null,
  slot: null,
};
const keeper: PlanItem = {
  kind: 'entity',
  id: 'entity-keeper',
  source: 'ai',
  entityKind: 'character',
  role: 'cast',
  name: '林潮',
  knownAs: '守灯人',
  profile: '守灯人，话少',
  appearance: null,
  slot: null,
};
const tower: PlanItem = {
  kind: 'entity',
  id: 'entity-tower',
  source: 'ai',
  entityKind: 'place',
  role: 'other',
  name: '灯塔',
  knownAs: null,
  profile: '镇子北面的灯塔',
  appearance: null,
  slot: null,
};
const secret: PlanItem = {
  kind: 'secret',
  id: 'secret-letter',
  source: 'ai',
  title: '上一任邮差的去向',
  statement: '上一任邮差在灯塔里住过一年',
  subjectId: 'entity-keeper',
  knowerIds: ['entity-keeper'],
  reveal: '主角拿到第三封旧信时',
};
const tide: PlanItem = {
  kind: 'state',
  id: 'state-tide',
  source: 'ai',
  key: '潮位',
  label: '潮位',
  display: 'number',
  config: { min: 0, max: 10, unit: '米', stages: [] },
  hidden: false,
  reveal: '',
  initial: '3',
};
const scene: PlanItem = {
  kind: 'scene',
  id: 'scene-tower',
  source: 'ai',
  condition: '主角第一次独自登上灯塔顶',
  outcome: '林潮讲起上一任邮差',
  once: true,
};
const ending: PlanItem = {
  kind: 'ending',
  id: 'ending-letters',
  source: 'ai',
  text: '三封旧信都送到收件人手里',
};

const fullPlan: PlanItem[] = [identity, situation, protagonist, keeper, tower, secret, tide, scene, ending];

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const deps = {
    dataDir: temp.dir,
    db: opened.db,
    bus: createEventBus(),
    logger,
    shutdown: new AbortController().signal,
  };
  const library = createLibraryService(deps);
  const authoring = createAuthoringService({ ...deps, llm: createScriptedLlm() });
  return { temp, opened, library, authoring };
}

function writePlan(db: Database, items: PlanItem[], castMode?: CastMode): number {
  const draft = db.select().from(workVersions).where(eq(workVersions.kind, 'draft')).get();
  if (!draft) throw new Error('draft missing');
  const meta = draft.meta as VersionMeta;
  const settings = castMode
    ? { ...readSettings(meta), cast: { ...readSettings(meta).cast, mode: castMode } }
    : meta.settings;
  db.update(workVersions)
    .set({
      meta: {
        ...meta,
        settings,
        plan: { items, conflicts: [], confirmedRev: null },
      },
    })
    .where(eq(workVersions.id, draft.id))
    .run();
  return draft.contentRev;
}

function draftMeta(db: Database): VersionMeta {
  const draft = db.select().from(workVersions).where(eq(workVersions.kind, 'draft')).get();
  return draft!.meta as VersionMeta;
}

function draftId(db: Database): string {
  return db.select().from(workVersions).where(eq(workVersions.kind, 'draft')).get()!.id;
}

describe('plan editing', () => {
  it('改一项后来源变成作者，方案回到未确认', () => {
    const { temp, opened, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      writePlan(opened.db, fullPlan);
      authoring.confirmPlan({ workId, baseContentRev: 1 });
      expect(library.get({ workId }).draft.plan?.confirmed).toBe(true);

      authoring.updatePlanItem({
        workId,
        baseContentRev: 2,
        item: { ...identity, text: '作者改过的身份' },
      });
      const work = library.get({ workId });
      expect(work.draft.contentRev).toBe(3);
      expect(work.draft.plan?.confirmed).toBe(false);
      expect(work.draft.plan?.items.find((item) => item.id === identity.id)).toMatchObject({
        text: '作者改过的身份',
        source: 'author',
      });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('不能删除主角', () => {
    const { temp, opened, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      writePlan(opened.db, fullPlan);
      try {
        authoring.removePlanItem({ workId, baseContentRev: 1, itemId: protagonist.id });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'invalid_input' });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('删除人物时清掉秘密里的引用', () => {
    const { temp, opened, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      writePlan(opened.db, fullPlan);
      authoring.removePlanItem({ workId, baseContentRev: 1, itemId: keeper.id });
      const removed = library
        .get({ workId })
        .draft.plan?.items.find((item) => item.kind === 'secret' && item.id === secret.id);
      expect(removed).toMatchObject({ subjectId: null, knowerIds: [] });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('确认方案写出结构化设定', () => {
    const { temp, opened, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      writePlan(opened.db, fullPlan);
      expect(authoring.confirmPlan({ workId, baseContentRev: 1 })).toEqual({ contentRev: 2 });

      const versionId = draftId(opened.db);
      const entityRows = opened.db.all<{
        id: string;
        kind: string;
        is_protagonist: number;
        origin_turn_id: string | null;
      }>(sql`select id, kind, is_protagonist, origin_turn_id from entities where version_id = ${versionId}`);
      expect(entityRows.map((row) => row.id).sort()).toEqual([protagonist.id, keeper.id, tower.id].sort());
      expect(entityRows.every((row) => row.origin_turn_id === null)).toBe(true);
      expect(entityRows.find((row) => row.id === protagonist.id)?.is_protagonist).toBe(1);

      const names = opened.db.all<{ name: string; holder_id: string }>(
        sql`select name, holder_id from entity_names where version_id = ${versionId}`,
      );
      expect(names).toContainEqual({ name: '守灯人', holder_id: protagonist.id });
      expect(names).toContainEqual({ name: '新来的邮差', holder_id: protagonist.id });

      const secretFacts = opened.db.all<{ id: string; kind: string }>(
        sql`select id, kind from facts where version_id = ${versionId} and kind = 'secret'`,
      );
      expect(secretFacts).toEqual([{ id: secret.id, kind: 'secret' }]);

      const knowledgeRows = opened.db.all<{ holder_id: string; level: string }>(
        sql`select holder_id, level from knowledge where version_id = ${versionId}`,
      );
      expect(knowledgeRows).toEqual([{ holder_id: keeper.id, level: 'confirmed' }]);

      const states = opened.db.all<{ id: string; display: string }>(
        sql`select id, display from state_defs where version_id = ${versionId}`,
      );
      expect(states).toEqual([{ id: tide.id, display: 'number' }]);

      const meta = draftMeta(opened.db);
      expect(meta.keyScenes).toEqual([
        { id: 'scene-tower', condition: '主角第一次独自登上灯塔顶', outcome: '林潮讲起上一任邮差', once: true },
      ]);
      expect(meta.ending).toBe('三封旧信都送到收件人手里');
      expect(meta.wizardStep).toBe('opening');
      expect(meta.plan?.confirmedRev).toBe(2);
      expect(library.get({ workId }).draft.plan?.confirmed).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('每局生成的人物写成人物位置', () => {
    const { temp, opened, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      const slotKeeper: PlanItem = {
        ...keeper,
        knownAs: null,
        slot: { role: '在灯塔下等主角的人', encounter: '主角在码头问路时遇见' },
      };
      writePlan(opened.db, [identity, situation, protagonist, tower, slotKeeper], 'per_run');
      authoring.confirmPlan({ workId, baseContentRev: 1 });

      const versionId = draftId(opened.db);
      const ids = opened.db
        .all<{ id: string }>(sql`select id from entities where version_id = ${versionId}`)
        .map((row) => row.id)
        .sort();
      expect(ids).toEqual([protagonist.id, tower.id].sort());
      const meta = draftMeta(opened.db);
      expect(meta.castSlots).toEqual([
        { id: slotKeeper.id, role: '在灯塔下等主角的人', encounter: '主角在码头问路时遇见' },
      ]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('重复确认会重写，不会累加', () => {
    const { temp, opened, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      writePlan(opened.db, fullPlan);
      authoring.confirmPlan({ workId, baseContentRev: 1 });
      authoring.confirmPlan({ workId, baseContentRev: 2 });
      const versionId = draftId(opened.db);
      const entityCount = opened.db.get<{ count: number }>(
        sql`select count(*) as count from entities where version_id = ${versionId}`,
      )?.count;
      expect(entityCount).toBe(3);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('草稿改过后确认被拒', () => {
    const { temp, opened, library, authoring } = setup();
    try {
      library.create({ workId });
      library.saveDraft({
        workId,
        baseContentRev: 0,
        background: '灯塔镇只在夜里通电。',
        settings: DEFAULT_WORK_SETTINGS,
      });
      writePlan(opened.db, fullPlan);
      library.saveDraft({ workId, baseContentRev: 1, background: '灯塔镇改了背景。', settings: DEFAULT_WORK_SETTINGS });
      try {
        authoring.confirmPlan({ workId, baseContentRev: 1 });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'stale_revision' });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});

describe('plan appearance', () => {
  function prepare() {
    const { temp, opened, library, authoring } = setup();
    library.create({ workId });
    library.saveDraft({
      workId,
      baseContentRev: 0,
      background: '灯塔镇只在夜里通电。',
      settings: DEFAULT_WORK_SETTINGS,
    });
    return { temp, opened, library, authoring };
  }

  it('确认方案时把人物形象写进档案', () => {
    const { temp, opened, library, authoring } = prepare();
    try {
      const withAppearance = fullPlan.map((item) =>
        item.id === keeper.id ? { ...keeper, appearance: '浅色雨衣的兜帽遮住脸，窄肩' } : item,
      );
      writePlan(opened.db, withAppearance);
      authoring.confirmPlan({ workId, baseContentRev: 1 });
      const versionId = draftId(opened.db);
      const row = opened.db.get<{ profile: string }>(
        sql`select profile from entities where version_id = ${versionId} and id = ${keeper.id}`,
      );
      expect(JSON.parse(row?.profile ?? '{}')).toEqual({
        text: keeper.profile,
        appearance: '浅色雨衣的兜帽遮住脸，窄肩',
      });
      expect(library.get({ workId }).draft.plan?.items.find((item) => item.id === keeper.id)).toMatchObject({
        appearance: '浅色雨衣的兜帽遮住脸，窄肩',
      });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('只有人物能带形象', () => {
    const { temp, opened, library, authoring } = prepare();
    try {
      writePlan(opened.db, fullPlan);
      authoring.updatePlanItem({
        workId,
        baseContentRev: 1,
        item: { ...keeper, appearance: '浅灰围巾' },
      });
      expect(library.get({ workId }).draft.plan?.items.find((item) => item.id === keeper.id)).toMatchObject({
        appearance: '浅灰围巾',
      });

      try {
        authoring.updatePlanItem({
          workId,
          baseContentRev: 2,
          item: { ...tower, appearance: '白色塔身' },
        });
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: 'invalid_input' });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
