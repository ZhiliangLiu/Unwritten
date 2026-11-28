import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ILLUSTRATION_STYLE, type IllustrationStyle, type StartIllustrationInput } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import { appearanceHash } from '../illustration/appearance.ts';
import { collectGarbage } from '../illustration/gc.ts';
import { createImageStore } from '../illustration/storage.ts';
import type { Logger } from '../log/logger.ts';
import { TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION, type PortraitSlotsStored } from '../store/illustration-types.ts';
import { createRecordingSummary } from '../test-support/fake-summary.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { seedLighthouseTown } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase, type OpenedDatabase } from '../store/db.ts';
import {
  entities,
  entityNames,
  facts,
  playthroughs,
  portraitSets,
  stateValues,
  turns,
  workVersions,
  works,
} from '../store/schema.ts';
import type { VersionMeta } from '../store/meta.ts';
import { createImageService } from '../image/service.ts';
import type { IllustrationService } from '../services.ts';
import { createPlayService } from './service.ts';

function silentLogger(): Logger {
  return {
    record() {},
    sample() {},
    async flush() {},
    async close() {},
  };
}

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = seedLighthouseTown(opened.db);
  const llm = createScriptedLlm();
  const deps = {
    dataDir: temp.dir,
    db: opened.db,
    bus: createEventBus(),
    logger: silentLogger(),
    shutdown: new AbortController().signal,
  };
  const play = createPlayService({
    ...deps,
    llm,
    summary: createRecordingSummary(),
    image: createImageService({ ...deps, llm }),
    illustration: {
      enqueue: () => {
        throw new Error('not used');
      },
      forRoute: () => new Map(),
    } as unknown as IllustrationService,
    onIllustrationQueued: () => {},
  });
  return { temp, opened, seeded, llm, play };
}

describe('play.start 固定人物', () => {
  it('固定人物的开局不调模型，占位符换成玩家填的名字', () => {
    const { temp, opened, seeded, llm, play } = setup();
    try {
      const playthroughId = randomUUID();
      const view = play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '阿岚' } });
      expect(view.routeId).not.toBeNull();
      expect(llm.runs).toHaveLength(0);
      const route = play.getRoute({ routeId: view.routeId! });
      const prose = route.turns[0]?.paragraphs.join('\n') ?? '';
      expect(prose).toContain('阿岚');
      expect(prose).not.toContain('{{');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('留空的填写项用默认值', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const playthroughId = randomUUID();
      const view = play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '   ' } });
      const route = play.getRoute({ routeId: view.routeId! });
      expect(route.turns[0]?.paragraphs.join('\n')).toContain('阿岚');
      const row = opened.db.select().from(playthroughs).where(eq(playthroughs.id, playthroughId)).get();
      expect(row?.protagonist).toEqual({ 名字: '阿岚', 职业: '邮差' });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('传了作品没有的填写项被拒', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      let error: unknown;
      try {
        play.start({ workId: seeded.workId, playthroughId: randomUUID(), protagonist: { 年龄: '三十' } });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: 'protagonist_input_invalid' });
      expect(opened.db.select().from(playthroughs).all()).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('填写值替换后段落数不变', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const view = play.start({ workId: seeded.workId, playthroughId: randomUUID(), protagonist: { 名字: '阿岚' } });
      const route = play.getRoute({ routeId: view.routeId! });
      expect(route.turns[0]?.paragraphs).toHaveLength(3);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('主角记得自己填的名字', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const view = play.start({ workId: seeded.workId, playthroughId: randomUUID(), protagonist: { 名字: '阿岚' } });
      const root = play.getRoute({ routeId: view.routeId! }).turns[0]!;
      const names = opened.db.select().from(entityNames).where(eq(entityNames.originTurnId, root.id)).all();
      expect(
        names.some(
          (row) =>
            row.entityId === seeded.ids.protagonist && row.holderId === seeded.ids.protagonist && row.name === '阿岚',
        ),
      ).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场的事实和初始状态写进根回合', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const view = play.start({ workId: seeded.workId, playthroughId: randomUUID(), protagonist: { 名字: '阿岚' } });
      const root = play.getRoute({ routeId: view.routeId! }).turns[0]!;
      const rootFacts = opened.db.select().from(facts).where(eq(facts.originTurnId, root.id)).all();
      expect(rootFacts.some((fact) => fact.kind === 'event')).toBe(true);
      const names = opened.db.select().from(entityNames).where(eq(entityNames.originTurnId, root.id)).all();
      expect(names.some((row) => row.entityId === seeded.ids.linchao && row.name === '守灯人')).toBe(true);
      const states = opened.db.select().from(stateValues).where(eq(stateValues.turnId, root.id)).all();
      const byId = new Map(states.map((row) => [row.stateDefId, row.value]));
      expect(byId.get(seeded.ids['state:潮位']!)).toBe('3');
      expect(byId.get(seeded.ids['state:信任']!)).toBe('陌生');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一个开局 id 重复提交只建一次', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const playthroughId = randomUUID();
      const playthroughsBefore = opened.db.select().from(playthroughs).all().length;
      const turnsBefore = opened.db.select().from(turns).all().length;
      const first = play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '阿岚' } });
      const second = play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '阿岚' } });
      expect(second.routeId).toBe(first.routeId);
      expect(opened.db.select().from(playthroughs).all()).toHaveLength(playthroughsBefore + 1);
      expect(opened.db.select().from(turns).all()).toHaveLength(turnsBefore + 1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('没发布的作品不能开局', () => {
    const { temp, opened, play } = setup();
    try {
      const workId = randomUUID();
      opened.db.run(
        sql`insert into works (id, draft_id, created_at, updated_at)
            values (${workId}, ${randomUUID()}, ${Date.now()}, ${Date.now()})`,
      );
      let error: unknown;
      try {
        play.start({ workId, playthroughId: randomUUID(), protagonist: {} });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: 'not_published' });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('第二个里程碑的作品也能重新开局', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const version = opened.db.select().from(workVersions).where(eq(workVersions.id, seeded.versionId)).get()!;
      const meta = version.meta as VersionMeta;
      const opening = meta.opening!;
      const legacy: VersionMeta = {
        ...meta,
        opening: {
          ...opening,
          createdIds: undefined,
          scene: { place: '码头', time: '夜里', present: [], presentIds: [seeded.ids.linchao!] },
        },
      };
      opened.db.run(sql`update work_versions set meta = ${JSON.stringify(legacy)} where id = ${seeded.versionId}`);
      const view = play.start({ workId: seeded.workId, playthroughId: randomUUID(), protagonist: { 名字: '阿岚' } });
      const root = play.getRoute({ routeId: view.routeId! }).turns[0]!;
      expect(root.paragraphs.join('\n')).toContain('阿岚');
      const names = opened.db.select().from(entityNames).where(eq(entityNames.originTurnId, root.id)).all();
      expect(names.some((row) => row.name === '阿岚')).toBe(true);
      expect(names.some((row) => row.entityId === seeded.ids.linchao && row.name === '守灯人')).toBe(true);
      const rootTurn = opened.db.select().from(turns).where(eq(turns.id, root.id)).get()!;
      expect(rootTurn.scene.present).toEqual(['林潮']);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});

function startIllustration(overrides: Partial<StartIllustrationInput> = {}): StartIllustrationInput {
  return {
    enabled: true,
    style: { kind: 'preset', preset: 'watercolor' },
    aspectPreference: '3:2',
    resolutionTier: '2k',
    protagonistInFrame: true,
    protagonistAppearance: '短发，旧风衣，左手缠着绷带。',
    protagonistSnapshotId: null,
    ...overrides,
  };
}

function slotsWithFront(ready: boolean): PortraitSlotsStored {
  return {
    front: {
      file: ready ? { hash: 'f'.repeat(64), mime: 'image/png', width: 4, height: 4, bytes: 32 } : null,
      source: ready ? 'generate' : null,
      needsReview: false,
    },
    three_quarter: { file: null, source: null, needsReview: false },
    full_body: { file: null, source: null, needsReview: false },
  };
}

function insertSet(
  opened: OpenedDatabase,
  input: {
    workId: string;
    scope: 'work' | 'pending';
    state: 'active';
    entityId: string;
    appearanceHash: string;
    updatedAt: number;
    frontReady: boolean;
  },
): string {
  const id = randomUUID();
  opened.db
    .insert(portraitSets)
    .values({
      id,
      workId: input.workId,
      scope: input.scope,
      playthroughId: null,
      entityId: input.entityId,
      appearanceFactId: null,
      appearanceHash: input.appearanceHash,
      appearance: '虚构形象',
      style: { kind: 'preset', preset: 'painterly' },
      state: input.state,
      draftRev: 0,
      slots: slotsWithFront(input.frontReady),
      task: null,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
    })
    .run();
  return id;
}

describe('play.start 插图设置', () => {
  it('不带插图设置时按纯文字开局，画风取作品默认画风', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const id = randomUUID();
      play.start({ workId: seeded.workId, playthroughId: id, protagonist: { 名字: '阿岚' } });
      const row = opened.db.select().from(playthroughs).where(eq(playthroughs.id, id)).get()!;
      expect(row.illustration).toEqual(TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION);

      const ink: IllustrationStyle = { kind: 'preset', preset: 'ink' };
      opened.db.update(works).set({ illustrationStyle: ink }).where(eq(works.id, seeded.workId)).run();
      const second = randomUUID();
      play.start({ workId: seeded.workId, playthroughId: second, protagonist: { 名字: '阿岚' } });
      const secondRow = opened.db.select().from(playthroughs).where(eq(playthroughs.id, second)).get()!;
      expect(secondRow.illustration).toEqual({ ...TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION, style: ink });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('带插图设置时原样保存，主角不入画时清空形象', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const id = randomUUID();
      play.start({
        workId: seeded.workId,
        playthroughId: id,
        protagonist: { 名字: '阿岚' },
        illustration: startIllustration({ protagonistInFrame: false }),
      });
      const row = opened.db.select().from(playthroughs).where(eq(playthroughs.id, id)).get()!;
      expect(row.illustration).toMatchObject({
        enabled: true,
        style: { kind: 'preset', preset: 'watercolor' },
        aspectPreference: '3:2',
        resolutionTier: '2k',
        protagonistInFrame: false,
        protagonistAppearance: null,
        protagonistPortraitSetId: null,
      });

      const second = randomUUID();
      play.start({
        workId: seeded.workId,
        playthroughId: second,
        protagonist: { 名字: '阿岚' },
        illustration: startIllustration(),
      });
      const secondRow = opened.db.select().from(playthroughs).where(eq(playthroughs.id, second)).get()!;
      expect(secondRow.illustration.protagonistAppearance).toBe('短发，旧风衣，左手缠着绷带。');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('作者参考组按形象哈希锁定，形象改了就锁不上', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const linchao = opened.db
        .select()
        .from(entities)
        .where(and(eq(entities.versionId, seeded.versionId), eq(entities.id, seeded.ids.linchao!)))
        .get()!;
      const appearance = '旧毡帽，灰呢大衣，右手提一盏马灯';
      opened.db
        .update(entities)
        .set({ profile: { ...linchao.profile, appearance } })
        .where(and(eq(entities.versionId, seeded.versionId), eq(entities.id, linchao.id)))
        .run();
      const setId = insertSet(opened, {
        workId: seeded.workId,
        scope: 'work',
        state: 'active',
        entityId: linchao.id,
        appearanceHash: appearanceHash(appearance),
        updatedAt: Date.now(),
        frontReady: true,
      });

      const first = randomUUID();
      play.start({ workId: seeded.workId, playthroughId: first, protagonist: {}, illustration: startIllustration() });
      const firstRow = opened.db.select().from(playthroughs).where(eq(playthroughs.id, first)).get()!;
      expect(firstRow.illustration.authorPortraitSetIds).toEqual({ [linchao.id]: setId });

      opened.db
        .update(entities)
        .set({ profile: { ...linchao.profile, appearance: '换了装束，看不清脸' } })
        .where(and(eq(entities.versionId, seeded.versionId), eq(entities.id, linchao.id)))
        .run();
      const second = randomUUID();
      play.start({ workId: seeded.workId, playthroughId: second, protagonist: {}, illustration: startIllustration() });
      const secondRow = opened.db.select().from(playthroughs).where(eq(playthroughs.id, second)).get()!;
      expect(secondRow.illustration.authorPortraitSetIds).toEqual({});
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('主角快照通过校验才锁定，校验不过时开局照常', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const appearance = '短发，旧风衣，左手缠着绷带。';
      const now = Date.now();
      const snapshotId = insertSet(opened, {
        workId: seeded.workId,
        scope: 'pending',
        state: 'active',
        entityId: seeded.ids.protagonist!,
        appearanceHash: appearanceHash(appearance),
        updatedAt: now,
        frontReady: true,
      });

      const locked = randomUUID();
      play.start({
        workId: seeded.workId,
        playthroughId: locked,
        protagonist: {},
        illustration: startIllustration({ protagonistSnapshotId: snapshotId }),
      });
      const lockedRow = opened.db.select().from(playthroughs).where(eq(playthroughs.id, locked)).get()!;
      expect(lockedRow.illustration.protagonistPortraitSetId).toBe(snapshotId);

      const mismatch = randomUUID();
      play.start({
        workId: seeded.workId,
        playthroughId: mismatch,
        protagonist: {},
        illustration: startIllustration({
          protagonistSnapshotId: snapshotId,
          protagonistAppearance: '长发及腰，深色长袍。',
        }),
      });
      const mismatchRow = opened.db.select().from(playthroughs).where(eq(playthroughs.id, mismatch)).get()!;
      expect(mismatchRow.illustration.protagonistPortraitSetId).toBeNull();
      expect(mismatchRow.rootTurnId).not.toBeNull();

      const otherWorkId = randomUUID();
      opened.db.run(
        sql`insert into works (id, draft_id, created_at, updated_at)
            values (${otherWorkId}, ${randomUUID()}, ${now}, ${now})`,
      );
      const foreignId = insertSet(opened, {
        workId: otherWorkId,
        scope: 'pending',
        state: 'active',
        entityId: seeded.ids.protagonist!,
        appearanceHash: appearanceHash(appearance),
        updatedAt: now,
        frontReady: true,
      });
      const foreign = randomUUID();
      play.start({
        workId: seeded.workId,
        playthroughId: foreign,
        protagonist: {},
        illustration: startIllustration({ protagonistSnapshotId: foreignId }),
      });
      const foreignRow = opened.db.select().from(playthroughs).where(eq(playthroughs.id, foreign)).get()!;
      expect(foreignRow.illustration.protagonistPortraitSetId).toBeNull();
      expect(foreignRow.rootTurnId).not.toBeNull();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('清理后仍能锁定符合条件的未引用快照', async () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const now = Date.now();
      const appearance = '短发，旧风衣，左手缠着绷带。';
      const snapshotId = insertSet(opened, {
        workId: seeded.workId,
        scope: 'pending',
        state: 'active',
        entityId: seeded.ids.protagonist!,
        appearanceHash: appearanceHash(appearance),
        updatedAt: now,
        frontReady: true,
      });
      const store = createImageStore(temp.dir, silentLogger());
      await collectGarbage({ db: opened.db, store, now, logger: silentLogger() });
      const id = randomUUID();
      play.start({
        workId: seeded.workId,
        playthroughId: id,
        protagonist: {},
        illustration: startIllustration({ protagonistSnapshotId: snapshotId }),
      });
      const row = opened.db.select().from(playthroughs).where(eq(playthroughs.id, id)).get()!;
      expect(row.illustration.protagonistPortraitSetId).toBe(snapshotId);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});

describe('play.getStartInfo 插图', () => {
  it('没选出图服务时不可用，画风与默认规格来自作品和应用设置', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      const info = play.getStartInfo({ workId: seeded.workId });
      expect(info.illustration.available).toBe(false);
      expect(info.illustration.autoEnabled).toBe(false);
      expect(info.illustration.authorStyle).toEqual(DEFAULT_ILLUSTRATION_STYLE);
      expect(info.illustration.lastStyle).toBeNull();
      expect(info.illustration.defaults).toEqual({ aspectPreference: 'auto', resolutionTier: '1k' });
      expect(info.illustration.protagonistEntityId).toBe(seeded.ids.protagonist);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('上一局主动用了水彩时 lastStyle 是水彩，作者画风单独返回', () => {
    const { temp, opened, seeded, play } = setup();
    try {
      play.start({
        workId: seeded.workId,
        playthroughId: randomUUID(),
        protagonist: {},
        illustration: startIllustration(),
      });
      const ink: IllustrationStyle = { kind: 'preset', preset: 'ink' };
      opened.db.update(works).set({ illustrationStyle: ink }).where(eq(works.id, seeded.workId)).run();
      const info = play.getStartInfo({ workId: seeded.workId });
      expect(info.illustration.lastStyle).toEqual({ kind: 'preset', preset: 'watercolor' });
      expect(info.illustration.authorStyle).toEqual(ink);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
