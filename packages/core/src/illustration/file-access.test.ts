import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { ImageFileRef, PortraitSlotsStored } from '../store/illustration-types.ts';
import { TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION } from '../store/illustration-types.ts';
import { illustrations, playthroughs, portraitSets, routes } from '../store/schema.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { ancestorChain } from '../play/chain.ts';
import { loadProjection } from '../story/projection.ts';
import { buildJournal } from '../story/journal.ts';
import type { StoryProjection } from '../story/types.ts';
import { pngBytes } from '../test-support/image-bytes.ts';
import { seedStory, type SeededStory } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { resolveImageFile } from './file-access.ts';
import { journalPortraits } from './journal-portraits.ts';
import { createImageStore, type ImageStore } from './storage.ts';

function slotsWith(front: ImageFileRef | null, threeQuarter: ImageFileRef | null = null): PortraitSlotsStored {
  return {
    front: { file: front, source: front === null ? null : 'generate', needsReview: false },
    three_quarter: { file: threeQuarter, source: threeQuarter === null ? null : 'generate', needsReview: false },
    full_body: { file: null, source: null, needsReview: false },
  };
}

async function readyRef(store: ImageStore, bytes: Uint8Array): Promise<ImageFileRef> {
  const staged = await store.stage(bytes);
  await store.commit([staged], () => undefined);
  return staged.ref;
}

function insertSet(
  db: Database,
  input: {
    workId: string;
    scope: 'work' | 'pending';
    entityId: string;
    slots: PortraitSlotsStored;
    updatedAt?: number;
  },
): string {
  const id = randomUUID();
  db.insert(portraitSets)
    .values({
      id,
      workId: input.workId,
      scope: input.scope,
      playthroughId: null,
      entityId: input.entityId,
      appearanceFactId: null,
      appearanceHash: randomUUID(),
      appearance: '虚构形象',
      style: { kind: 'preset', preset: 'painterly' },
      state: 'active',
      draftRev: 0,
      slots: input.slots,
      task: null,
      createdAt: input.updatedAt ?? 1_700_000_000_000,
      updatedAt: input.updatedAt ?? 1_700_000_000_000,
    })
    .run();
  return id;
}

function insertIllustration(
  db: Database,
  input: {
    turnId: string;
    playthroughId: string;
    status: 'done' | 'failed' | 'queued';
    file: ImageFileRef | null;
  },
): string {
  const id = randomUUID();
  db.insert(illustrations)
    .values({
      id,
      turnId: input.turnId,
      playthroughId: input.playthroughId,
      para: 1,
      formatPreference: { aspectPreference: 'auto', resolutionTier: '1k' },
      status: input.status,
      file: input.file,
      attempts: 0,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    })
    .run();
  return id;
}

function insertRoute(db: Database, playthroughId: string, headTurnId: string): string {
  const id = randomUUID();
  db.insert(routes)
    .values({ id, playthroughId, headTurnId, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 })
    .run();
  return id;
}

function projectionOf(db: Database, seeded: SeededStory, headTurnId: string): StoryProjection {
  const chain = ancestorChain(db, headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  return loadProjection(db, { versionId: seeded.versionId, chain });
}

function settingsWith(ids: Record<string, string>) {
  return { ...TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION, enabled: true, authorPortraitSetIds: ids };
}

async function errorCode(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function bytesOf(file: File): Promise<number[]> {
  return file.arrayBuffer().then((buffer) => [...new Uint8Array(buffer)]);
}

async function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const store = createImageStore(temp.dir);
  return { temp, opened, store };
}

function simpleStory(db: Database, keys: { second?: boolean } = {}): SeededStory {
  const turns = keys.second
    ? [{ prose: '开场。' }, { prose: '第一段。' }, { prose: '另一段。' }]
    : [{ prose: '开场。' }, { prose: '第一段。' }];
  return seedStory(db, {
    turns,
    head: turns.length === 3 ? 1 : turns.length - 1,
    entities: [
      { key: 'lin', kind: 'character', name: '林远', protagonist: true },
      { key: 'shen', kind: 'character', name: '沈岚' },
    ],
  });
}

describe('resolveImageFile 作品视图', () => {
  it('只返回本作品的参考组，作品视图取插图一律 not_found', async () => {
    const { temp, opened, store } = await setup();
    try {
      const first = simpleStory(opened.db);
      const second = simpleStory(opened.db);
      const bytes = pngBytes(4, 4);
      const ref = await readyRef(store, bytes);
      const ownSet = insertSet(opened.db, {
        workId: first.workId,
        scope: 'work',
        entityId: first.ids.shen ?? '',
        slots: slotsWith(ref),
      });
      const pendingSet = insertSet(opened.db, {
        workId: first.workId,
        scope: 'pending',
        entityId: first.ids.shen ?? '',
        slots: slotsWith(ref),
      });
      const otherSet = insertSet(opened.db, {
        workId: second.workId,
        scope: 'work',
        entityId: second.ids.shen ?? '',
        slots: slotsWith(ref),
      });

      const file = await resolveImageFile(opened.db, store, {
        view: { kind: 'work', workId: first.workId },
        image: { kind: 'portrait', setId: ownSet, slot: 'front' },
      });
      expect(file.type).toBe('image/png');
      expect(file.name).toBe(`${ownSet}.png`);
      expect(await bytesOf(file)).toEqual([...bytes]);
      expect(
        await resolveImageFile(opened.db, store, {
          view: { kind: 'work', workId: first.workId },
          image: { kind: 'portrait', setId: pendingSet, slot: 'front' },
        }).then(bytesOf),
      ).toEqual([...bytes]);
      expect(
        await errorCode(
          resolveImageFile(opened.db, store, {
            view: { kind: 'work', workId: first.workId },
            image: { kind: 'portrait', setId: otherSet, slot: 'front' },
          }),
        ),
      ).toBe('not_found');

      const illustrationId = insertIllustration(opened.db, {
        turnId: first.turnIds[0] ?? '',
        playthroughId: first.playthroughId,
        status: 'done',
        file: ref,
      });
      expect(
        await errorCode(
          resolveImageFile(opened.db, store, {
            view: { kind: 'work', workId: first.workId },
            image: { kind: 'illustration', illustrationId },
          }),
        ),
      ).toBe('not_found');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});

describe('resolveImageFile 路线视图', () => {
  it('取本路线上的完成插图，另一条路线的插图 not_found', async () => {
    const { temp, opened, store } = await setup();
    try {
      const seeded = simpleStory(opened.db, { second: true });
      const otherRouteId = insertRoute(opened.db, seeded.playthroughId, seeded.turnIds[2] ?? '');
      const firstBytes = pngBytes(4, 4);
      const secondBytes = pngBytes(5, 5);
      const firstRef = await readyRef(store, firstBytes);
      const secondRef = await readyRef(store, secondBytes);
      const firstId = insertIllustration(opened.db, {
        turnId: seeded.turnIds[1] ?? '',
        playthroughId: seeded.playthroughId,
        status: 'done',
        file: firstRef,
      });
      const secondId = insertIllustration(opened.db, {
        turnId: seeded.turnIds[2] ?? '',
        playthroughId: seeded.playthroughId,
        status: 'done',
        file: secondRef,
      });

      const file = await resolveImageFile(opened.db, store, {
        view: { kind: 'route', routeId: seeded.routeId },
        image: { kind: 'illustration', illustrationId: firstId },
      });
      expect(file.type).toBe('image/png');
      expect(file.name).toBe(`${firstId}.png`);
      expect(await bytesOf(file)).toEqual([...firstBytes]);

      expect(
        await errorCode(
          resolveImageFile(opened.db, store, {
            view: { kind: 'route', routeId: seeded.routeId },
            image: { kind: 'illustration', illustrationId: secondId },
          }),
        ),
      ).toBe('not_found');
      expect(
        await resolveImageFile(opened.db, store, {
          view: { kind: 'route', routeId: otherRouteId },
          image: { kind: 'illustration', illustrationId: secondId },
        }).then(bytesOf),
      ).toEqual([...secondBytes]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('未完成的插图 not_found', async () => {
    const { temp, opened, store } = await setup();
    try {
      const seeded = simpleStory(opened.db);
      const bytes = pngBytes(4, 4);
      const ref = await readyRef(store, bytes);
      const doneId = insertIllustration(opened.db, {
        turnId: seeded.turnIds[0] ?? '',
        playthroughId: seeded.playthroughId,
        status: 'done',
        file: ref,
      });
      const failedId = insertIllustration(opened.db, {
        turnId: seeded.turnIds[1] ?? '',
        playthroughId: seeded.playthroughId,
        status: 'failed',
        file: ref,
      });
      expect(
        await resolveImageFile(opened.db, store, {
          view: { kind: 'route', routeId: seeded.routeId },
          image: { kind: 'illustration', illustrationId: doneId },
        }).then(bytesOf),
      ).toEqual([...bytes]);
      expect(
        await errorCode(
          resolveImageFile(opened.db, store, {
            view: { kind: 'route', routeId: seeded.routeId },
            image: { kind: 'illustration', illustrationId: failedId },
          }),
        ),
      ).toBe('not_found');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('文件被删时抛 image_file_missing', async () => {
    const { temp, opened, store } = await setup();
    try {
      const seeded = simpleStory(opened.db);
      const keptBytes = pngBytes(4, 4);
      const removedBytes = pngBytes(5, 5);
      const keptRef = await readyRef(store, keptBytes);
      const removedRef = await readyRef(store, removedBytes);
      rmSync(store.pathOf(removedRef));
      const keptId = insertIllustration(opened.db, {
        turnId: seeded.turnIds[0] ?? '',
        playthroughId: seeded.playthroughId,
        status: 'done',
        file: keptRef,
      });
      const removedId = insertIllustration(opened.db, {
        turnId: seeded.turnIds[1] ?? '',
        playthroughId: seeded.playthroughId,
        status: 'done',
        file: removedRef,
      });
      expect(
        await resolveImageFile(opened.db, store, {
          view: { kind: 'route', routeId: seeded.routeId },
          image: { kind: 'illustration', illustrationId: keptId },
        }).then(bytesOf),
      ).toEqual([...keptBytes]);
      expect(
        await errorCode(
          resolveImageFile(opened.db, store, {
            view: { kind: 'route', routeId: seeded.routeId },
            image: { kind: 'illustration', illustrationId: removedId },
          }),
        ),
      ).toBe('image_file_missing');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('两条路线的手记缩略图各不相同，组 id 不能跨路线使用', async () => {
    const { temp, opened, store } = await setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', place: '码头', presentKeys: [] },
          { prose: '第一段。', place: '码头', presentKeys: ['shen'] },
          { prose: '另一段。', place: '镇上', presentKeys: [] },
        ],
        head: 1,
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
        ],
        names: [{ entity: 'shen', name: '沈岚', holder: 'lin', originTurn: 0, para: 1 }],
        facts: [
          {
            key: 'metShen',
            kind: 'relation',
            subject: 'lin',
            object: 'shen',
            factKey: 'acquaintance',
            statement: '林远在码头见到沈岚',
            data: { stage: 'met' },
            originTurn: 1,
            para: 1,
          },
          {
            key: 'heardShen',
            kind: 'relation',
            subject: 'lin',
            object: 'shen',
            factKey: 'acquaintance',
            statement: '林远听说沈岚去了镇上',
            data: { stage: 'heard' },
            originTurn: 2,
            para: 1,
          },
        ],
      });
      const routeB = insertRoute(opened.db, seeded.playthroughId, seeded.turnIds[2] ?? '');
      const bytes = pngBytes(4, 4);
      const front = await readyRef(store, bytes);
      const side = await readyRef(store, pngBytes(5, 5));
      const setId = insertSet(opened.db, {
        workId: seeded.workId,
        scope: 'work',
        entityId: seeded.ids.shen ?? '',
        slots: slotsWith(front, side),
        updatedAt: 1_700_000_000_123,
      });
      const settings = settingsWith({ [seeded.ids.shen ?? '']: setId });
      opened.db
        .update(playthroughs)
        .set({ illustration: settings })
        .where(eq(playthroughs.id, seeded.playthroughId))
        .run();

      const projectionA = projectionOf(opened.db, seeded, seeded.headTurnId);
      const journalA = buildJournal(
        projectionA,
        seeded.routeId,
        journalPortraits(opened.db, {
          routeId: seeded.routeId,
          projection: projectionA,
          settings,
          playthroughId: seeded.playthroughId,
        }),
      );
      const subjectA = journalA.subjects.find((subject) => subject.entityId === seeded.ids.shen);
      expect(subjectA?.portrait).toEqual({ setId, updatedAt: 1_700_000_000_123 });

      const projectionB = projectionOf(opened.db, seeded, seeded.turnIds[2] ?? '');
      const journalB = buildJournal(
        projectionB,
        routeB,
        journalPortraits(opened.db, {
          routeId: routeB,
          projection: projectionB,
          settings,
          playthroughId: seeded.playthroughId,
        }),
      );
      const subjectB = journalB.subjects.find((subject) => subject.entityId === seeded.ids.shen);
      expect(subjectB).toBeDefined();
      expect(subjectB?.portrait).toBeNull();

      expect(
        await errorCode(
          resolveImageFile(opened.db, store, {
            view: { kind: 'route', routeId: routeB },
            image: { kind: 'portrait', setId, slot: 'front' },
          }),
        ),
      ).toBe('not_found');
      expect(
        await errorCode(
          resolveImageFile(opened.db, store, {
            view: { kind: 'route', routeId: seeded.routeId },
            image: { kind: 'portrait', setId, slot: 'three_quarter' },
          }),
        ),
      ).toBe('not_found');
      const file = await resolveImageFile(opened.db, store, {
        view: { kind: 'route', routeId: seeded.routeId },
        image: { kind: 'portrait', setId, slot: 'front' },
      });
      expect(file.type).toBe('image/png');
      expect(file.name).toBe(`${setId}.png`);
      expect(await bytesOf(file)).toEqual([...bytes]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
