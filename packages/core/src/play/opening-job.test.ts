import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { changeLines, proposeCastStep, proposeOpeningStep } from '../test-support/llm-steps.ts';
import { createRecordingSummary } from '../test-support/fake-summary.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { seedLighthouseTown } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase } from '../store/db.ts';
import { entities, playthroughs, stateValues, workVersions } from '../store/schema.ts';
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

const castNames = ['陶枝', '祁望'];
const castChanges = changeLines(
  {
    type: 'new_entity',
    kind: 'character',
    name: '陶枝',
    known_as: '提灯的人',
    profile: '守灯人，话少',
    para: '1',
    slot: '1',
  },
  {
    type: 'new_entity',
    kind: 'character',
    name: '祁望',
    known_as: '掌柜',
    profile: '掌柜，爱打盹',
    para: '2',
    slot: '2',
  },
);

function castStep() {
  return proposeCastStep([
    { slot: '1', name: '陶枝', known_as: '提灯的人', profile: '守灯人，话少', appearance: '短卷发，穿深色短外套' },
    { slot: '2', name: '祁望', known_as: '掌柜', profile: '掌柜，爱打盹' },
  ]);
}

function openingStep(overrides: { prose?: string } = {}) {
  return proposeOpeningStep({
    prose: overrides.prose ?? '船靠岸时，阿岚看见提灯的人。\n\n掌柜从门后走出来。',
    options: ['向提灯的人问路', '等在原地'],
    place: '码头',
    time: '夜里',
    present: castNames,
    changes: castChanges,
  });
}

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = seedLighthouseTown(opened.db);
  const version = opened.db.select().from(workVersions).where(eq(workVersions.id, seeded.versionId)).get()!;
  const meta = version.meta as VersionMeta;
  if (!meta.settings || !meta.opening) throw new Error('fixture missing settings');
  const perRun: VersionMeta = {
    ...meta,
    settings: { ...meta.settings, cast: { ...meta.settings.cast, mode: 'per_run' } },
    castSlots: [
      { id: 'slot-tide', role: '守灯人', encounter: '在码头提灯等着' },
      { id: 'slot-post', role: '邮局掌柜', encounter: '在柜台后打盹' },
    ],
  };
  opened.db.run(sql`update work_versions set meta = ${JSON.stringify(perRun)} where id = ${seeded.versionId}`);
  const llm = createScriptedLlm();
  const published: CoreEvent[] = [];
  const bus = createEventBus();
  const deps = {
    dataDir: temp.dir,
    db: opened.db,
    bus: {
      publish(event: CoreEvent) {
        published.push(event);
        bus.publish(event);
      },
      subscribe(signal: AbortSignal) {
        return bus.subscribe(signal);
      },
    },
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
  return { temp, opened, seeded, llm, published, play };
}

describe('opening job 每局生成', () => {
  it('每局生成：先生成人物再写开场', async () => {
    const { temp, opened, seeded, llm, play } = setup();
    try {
      const playthroughId = randomUUID();
      llm.enqueue(castStep(), openingStep());
      const view = play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '阿岚' } });
      expect(view.routeId).toBeNull();
      expect(view.opening?.status).toBe('running');
      await play.whenIdle();
      expect(llm.runs.map((run) => run.requiredToolName)).toEqual(['propose_cast', 'propose_opening']);
      const done = play.getPlaythrough({ playthroughId });
      expect(done.routeId).not.toBeNull();
      const route = play.getRoute({ routeId: done.routeId! });
      expect(route.turns).toHaveLength(1);
      const root = route.turns[0]!;
      const generated = opened.db
        .select()
        .from(entities)
        .where(and(eq(entities.versionId, seeded.versionId), eq(entities.originTurnId, root.id)))
        .all();
      expect(generated.map((entity) => entity.name).sort()).toEqual([...castNames].sort());
      expect(generated.every((entity) => entity.castSlot !== null)).toBe(true);
      const torchBearer = generated.find((entity) => entity.name === '陶枝');
      expect(torchBearer?.profile).toEqual({ text: '守灯人，话少', appearance: '短卷发，穿深色短外套' });
      const stored = opened.db.select().from(playthroughs).where(eq(playthroughs.id, playthroughId)).get()!;
      expect(stored.cast).toBeNull();
      const states = opened.db.select().from(stateValues).where(eq(stateValues.turnId, root.id)).all();
      const tide = states.find((row) => row.stateDefId === seeded.ids['state:潮位']);
      expect(tide?.value).toBe('3');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场失败后重试沿用已生成的人物', async () => {
    const { temp, opened, seeded, llm, play } = setup();
    try {
      const playthroughId = randomUUID();
      llm.enqueue(castStep(), { fail: 'timeout' });
      play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '阿岚' } });
      await play.whenIdle();
      const failed = play.getPlaythrough({ playthroughId });
      expect(failed.opening?.status).toBe('failed');
      expect(failed.opening?.error).toBe('timeout');
      const stored = opened.db.select().from(playthroughs).where(eq(playthroughs.id, playthroughId)).get()!;
      const cast = stored.cast as Array<{ name: string }>;
      expect(cast.map((member) => member.name)).toEqual(castNames);

      llm.enqueue(openingStep());
      const retried = play.retryOpening({ requestId: failed.opening!.id });
      expect(retried.opening?.status).toBe('running');
      await play.whenIdle();
      expect(llm.runs.map((run) => run.requiredToolName)).toEqual([
        'propose_cast',
        'propose_opening',
        'propose_opening',
      ]);
      const done = play.getPlaythrough({ playthroughId });
      expect(done.routeId).not.toBeNull();
      const root = play.getRoute({ routeId: done.routeId! }).turns[0]!;
      const generated = opened.db
        .select()
        .from(entities)
        .where(and(eq(entities.versionId, seeded.versionId), eq(entities.originTurnId, root.id)))
        .all();
      expect(generated.map((entity) => entity.name).sort()).toEqual([...castNames].sort());
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开局完成时发出 turn.committed 和 playthrough.updated', async () => {
    const { temp, opened, seeded, llm, published, play } = setup();
    try {
      const playthroughId = randomUUID();
      llm.enqueue(castStep(), openingStep());
      play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '阿岚' } });
      await play.whenIdle();
      const done = play.getPlaythrough({ playthroughId });
      expect(done.routeId).not.toBeNull();
      const route = play.getRoute({ routeId: done.routeId! });
      expect(published).toContainEqual({
        type: 'playthrough.updated',
        playthroughId,
        requestId: done.opening!.id,
        status: 'done',
      });
      expect(published).toContainEqual({ type: 'turn.committed', routeId: done.routeId, turnId: route.headTurnId });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场里不能再有占位符', async () => {
    const { temp, opened, seeded, llm, play } = setup();
    try {
      const playthroughId = randomUUID();
      llm.enqueue(
        castStep(),
        openingStep({ prose: '阿岚看见{{protagonist.名字}}站在码头。\n\n掌柜从门后走出来。' }),
        openingStep(),
      );
      play.start({ workId: seeded.workId, playthroughId, protagonist: { 名字: '阿岚' } });
      await play.whenIdle();
      expect(llm.runs.map((run) => run.requiredToolName)).toEqual(['propose_cast', 'propose_opening']);
      const done = play.getPlaythrough({ playthroughId });
      expect(done.routeId).not.toBeNull();
      const prose = play.getRoute({ routeId: done.routeId! }).turns[0]?.paragraphs.join('\n') ?? '';
      expect(prose).toContain('阿岚');
      expect(prose).not.toContain('{{');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
