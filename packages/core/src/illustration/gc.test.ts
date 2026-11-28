import { randomUUID } from 'node:crypto';
import { existsSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { LogEvent, Logger, PerformanceSample } from '../log/logger.ts';
import type { ImageFileRef, PortraitSlotsStored, PortraitTasks } from '../store/illustration-types.ts';
import { illustrations, portraitSets, works } from '../store/schema.ts';
import { openDatabase, type OpenedDatabase } from '../store/db.ts';
import { pngBytes } from '../test-support/image-bytes.ts';
import { seedStory, type SeededStory } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { IMAGE_GC_GRACE_MS, PORTRAIT_PREVIEW_TTL_DAYS } from './constants.ts';
import { collectGarbage, referencedFiles, storageSummary } from './gc.ts';
import { createImageStore, type ImageStore } from './storage.ts';

const DAY_MS = 86_400_000;
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function hashOf(value: number): string {
  return value.toString(16).padStart(64, '0');
}

function fileRef(hash: string, bytes = 32): ImageFileRef {
  return { hash, mime: 'image/png', width: 4, height: 4, bytes };
}

function slotsWith(front: ImageFileRef | null = null): PortraitSlotsStored {
  return {
    front: { file: front, source: front ? 'generate' : null, needsReview: false },
    three_quarter: { file: null, source: null, needsReview: false },
    full_body: { file: null, source: null, needsReview: false },
  };
}

function tasksWith(front: Partial<PortraitTasks['front']>): PortraitTasks {
  return {
    front: {
      attemptId: randomUUID(),
      status: 'running',
      error: null,
      format: null,
      quality: 'best',
      inputFiles: [],
      appearanceHash: null,
      ...front,
    },
    three_quarter: null,
    full_body: null,
  };
}

interface Fixture {
  opened: OpenedDatabase;
  seeded: SeededStory;
  store: ImageStore;
  logger: Logger;
  events: LogEvent[];
  samples: PerformanceSample[];
  now: number;
  root: string;
}

function setup(): Fixture {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const events: LogEvent[] = [];
  const samples: PerformanceSample[] = [];
  const logger: Logger = {
    record(event) {
      events.push(event);
    },
    sample(sample) {
      samples.push(sample);
    },
    async flush() {},
    async close() {},
  };
  cleanups.push(() => {
    opened.close();
    temp.cleanup();
  });
  const seeded = seedStory(opened.db, {
    turns: Array.from({ length: 6 }, (_, index) => ({ prose: `第${index + 1}段正文。` })),
    entities: [
      { key: 'hero', kind: 'character', name: '主角', protagonist: true },
      { key: 'lin', kind: 'character', name: '林远' },
    ],
  });
  const store = createImageStore(temp.dir);
  return {
    opened,
    seeded,
    store,
    logger,
    events,
    samples,
    now: Date.now(),
    root: join(temp.dir, 'images'),
  };
}

function writeBlob(fixture: Fixture, hash: string, modifiedAt: number, size = 32): string {
  const path = join(fixture.root, 'blobs', `${hash}.png`);
  writeFileSync(path, Buffer.alloc(size, 7));
  utimesSync(path, modifiedAt / 1000, modifiedAt / 1000);
  return path;
}

function insertSet(fixture: Fixture, overrides: Partial<typeof portraitSets.$inferInsert> = {}): string {
  const id = overrides.id ?? randomUUID();
  fixture.opened.db
    .insert(portraitSets)
    .values({
      id,
      workId: fixture.seeded.workId,
      scope: 'work',
      playthroughId: null,
      entityId: fixture.seeded.ids.lin ?? null,
      appearanceFactId: null,
      appearanceHash: hashOf(1),
      appearance: '虚构形象',
      style: { kind: 'preset', preset: 'painterly' },
      state: 'active',
      draftRev: 0,
      slots: slotsWith(),
      task: null,
      createdAt: fixture.now,
      updatedAt: fixture.now,
      ...overrides,
    })
    .run();
  return id;
}

function insertIllustration(
  fixture: Fixture,
  turnIndex: number,
  overrides: Partial<typeof illustrations.$inferInsert> = {},
): string {
  const id = overrides.id ?? randomUUID();
  fixture.opened.db
    .insert(illustrations)
    .values({
      id,
      turnId: fixture.seeded.turnIds[turnIndex] ?? '',
      playthroughId: fixture.seeded.playthroughId,
      para: 1,
      formatPreference: { aspectPreference: 'auto', resolutionTier: '1k' },
      status: 'done',
      createdAt: fixture.now,
      updatedAt: fixture.now,
      ...overrides,
    })
    .run();
  return id;
}

function setExists(fixture: Fixture, id: string): boolean {
  return (
    fixture.opened.db.select({ id: portraitSets.id }).from(portraitSets).where(eq(portraitSets.id, id)).get() !==
    undefined
  );
}

function lockPlaythroughSet(fixture: Fixture, setId: string): void {
  fixture.opened.db.run(
    sql`update playthroughs set illustration = json_set(illustration, '$.protagonistPortraitSetId', ${setId})
        where id = ${fixture.seeded.playthroughId}`,
  );
}

const oldTime = () => Date.now() - IMAGE_GC_GRACE_MS - 60_000;

describe('collectGarbage', () => {
  it('保留开局引用的参考组', async () => {
    const fixture = setup();
    const ref = fileRef(hashOf(1));
    const setId = insertSet(fixture, {
      scope: 'pending',
      state: 'active',
      entityId: fixture.seeded.ids.hero ?? null,
      appearanceHash: hashOf(2),
      slots: slotsWith(ref),
      updatedAt: fixture.now - (PORTRAIT_PREVIEW_TTL_DAYS + 1) * DAY_MS,
    });
    lockPlaythroughSet(fixture, setId);
    const path = writeBlob(fixture, ref.hash, oldTime());

    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });

    expect(setExists(fixture, setId)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('保留现有人物的已采用组', async () => {
    const fixture = setup();
    const ref = fileRef(hashOf(11));
    const setId = insertSet(fixture, { slots: slotsWith(ref) });
    const path = writeBlob(fixture, ref.hash, oldTime());

    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });

    expect(setExists(fixture, setId)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('保留编辑草稿', async () => {
    const fixture = setup();
    const ref = fileRef(hashOf(21));
    const setId = insertSet(fixture, { state: 'draft', slots: slotsWith(ref) });
    const path = writeBlob(fixture, ref.hash, oldTime());

    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });

    expect(setExists(fixture, setId)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('保留未过期的预览', async () => {
    const fixture = setup();
    const ref = fileRef(hashOf(31));
    const setId = insertSet(fixture, {
      scope: 'pending',
      state: 'draft',
      entityId: null,
      slots: slotsWith(ref),
    });
    const path = writeBlob(fixture, ref.hash, oldTime());

    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });

    expect(setExists(fixture, setId)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('保留仍在运行的预览任务', async () => {
    const fixture = setup();
    const ref = fileRef(hashOf(32));
    const setId = insertSet(fixture, {
      scope: 'pending',
      state: 'draft',
      entityId: null,
      slots: slotsWith(ref),
      task: tasksWith({ status: 'running' }),
      updatedAt: fixture.now - (PORTRAIT_PREVIEW_TTL_DAYS + 1) * DAY_MS,
    });
    const path = writeBlob(fixture, ref.hash, oldTime());

    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });

    expect(setExists(fixture, setId)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('保留插图的完成文件', async () => {
    const fixture = setup();
    const ref = fileRef(hashOf(41));
    insertIllustration(fixture, 0, { file: ref });
    const path = writeBlob(fixture, ref.hash, oldTime());

    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });

    expect(existsSync(path)).toBe(true);
  });

  it('保留插图的参考文件和尝试数据里的参考文件', async () => {
    const fixture = setup();
    const first = fileRef(hashOf(51));
    const second = fileRef(hashOf(52));
    insertIllustration(fixture, 1, {
      referenceFiles: [{ setId: randomUUID(), slot: 'front', file: first }],
      attemptData: {
        attemptId: randomUUID(),
        kind: 'retry',
        formatOverride: null,
        format: null,
        shot: null,
        referenceFiles: [{ setId: randomUUID(), slot: 'front', file: second }],
        seed: null,
        serviceId: null,
        completed: [],
      },
    });
    const firstPath = writeBlob(fixture, first.hash, oldTime());
    const secondPath = writeBlob(fixture, second.hash, oldTime());

    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });

    expect(existsSync(firstPath)).toBe(true);
    expect(existsSync(secondPath)).toBe(true);
  });

  it('保留参考组任务登记的输入文件', async () => {
    const fixture = setup();
    const input = fileRef(hashOf(61));
    const setId = insertSet(fixture, {
      state: 'draft',
      appearanceHash: hashOf(2),
      task: tasksWith({ inputFiles: [input] }),
    });
    const path = writeBlob(fixture, input.hash, oldTime());

    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });

    expect(setExists(fixture, setId)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it('运行中的参考任务在所有范围内都保留该组，任务清掉后回收', async () => {
    const fixture = setup();
    const playthroughRef = fileRef(hashOf(121));
    const playthroughSet = insertSet(fixture, {
      scope: 'playthrough',
      playthroughId: fixture.seeded.playthroughId,
      entityId: fixture.seeded.ids.lin ?? null,
      state: 'active',
      appearanceHash: hashOf(122),
      slots: slotsWith(playthroughRef),
      task: tasksWith({ status: 'running' }),
    });
    const playthroughPath = writeBlob(fixture, playthroughRef.hash, oldTime());

    const activeRef = fileRef(hashOf(123));
    const activeSet = insertSet(fixture, {
      state: 'active',
      entityId: randomUUID(),
      appearanceHash: hashOf(124),
      slots: slotsWith(activeRef),
      task: tasksWith({ status: 'running' }),
    });
    const activePath = writeBlob(fixture, activeRef.hash, oldTime());

    const first = await collectGarbage({
      db: fixture.opened.db,
      store: fixture.store,
      now: fixture.now,
      logger: fixture.logger,
    });

    expect(setExists(fixture, playthroughSet)).toBe(true);
    expect(existsSync(playthroughPath)).toBe(true);
    expect(setExists(fixture, activeSet)).toBe(true);
    expect(existsSync(activePath)).toBe(true);
    expect(first.sets).toBe(0);

    fixture.opened.db.update(portraitSets).set({ task: null }).where(eq(portraitSets.id, playthroughSet)).run();
    fixture.opened.db
      .update(portraitSets)
      .set({ task: null, state: 'retired' })
      .where(eq(portraitSets.id, activeSet))
      .run();

    const second = await collectGarbage({
      db: fixture.opened.db,
      store: fixture.store,
      now: fixture.now,
      logger: fixture.logger,
    });

    expect(setExists(fixture, playthroughSet)).toBe(false);
    expect(existsSync(playthroughPath)).toBe(false);
    expect(setExists(fixture, activeSet)).toBe(false);
    expect(existsSync(activePath)).toBe(false);
    expect(second.sets).toBe(2);
  });

  it('回收无人引用的已撤下参考组和它的文件', async () => {
    const fixture = setup();
    const ref = fileRef(hashOf(71));
    const setId = insertSet(fixture, { state: 'retired', slots: slotsWith(ref) });
    const path = writeBlob(fixture, ref.hash, oldTime(), ref.bytes);

    const result = await collectGarbage({
      db: fixture.opened.db,
      store: fixture.store,
      now: fixture.now,
      logger: fixture.logger,
    });

    expect(setExists(fixture, setId)).toBe(false);
    expect(existsSync(path)).toBe(false);
    expect(result).toEqual({ sets: 1, files: 1, bytes: ref.bytes });
    expect(fixture.events).toContainEqual(
      expect.objectContaining({ event: 'image.gc', data: { sets: 1, files: 1, bytes: ref.bytes } }),
    );
    expect(fixture.samples).toContainEqual(
      expect.objectContaining({ metric: 'image.gc', data: { files: 1, bytes: ref.bytes } }),
    );
  });

  it('保护期内没人引用的文件不删', async () => {
    const fixture = setup();
    const young = hashOf(81);
    const old = hashOf(82);
    const youngPath = writeBlob(fixture, young, fixture.now - 1_000);
    const oldPath = writeBlob(fixture, old, oldTime());

    const result = await collectGarbage({
      db: fixture.opened.db,
      store: fixture.store,
      now: fixture.now,
      logger: fixture.logger,
    });

    expect(existsSync(youngPath)).toBe(true);
    expect(existsSync(oldPath)).toBe(false);
    expect(result.files).toBe(1);
  });

  it('主角快照在保留期内可读，过期后被回收，被开局锁定的不受影响', async () => {
    const fixture = setup();
    const freshBytes = pngBytes(4, 4);
    const fresh = await fixture.store.stage(freshBytes);
    await fixture.store.commit([fresh], () => undefined);
    const freshSet = insertSet(fixture, {
      scope: 'pending',
      state: 'active',
      entityId: fixture.seeded.ids.hero ?? null,
      appearanceHash: hashOf(3),
      slots: slotsWith(fresh.ref),
      updatedAt: fixture.now - 1_000,
    });
    utimesSync(fixture.store.pathOf(fresh.ref), oldTime() / 1000, oldTime() / 1000);

    const expiredBytes = pngBytes(5, 4);
    const expired = await fixture.store.stage(expiredBytes);
    await fixture.store.commit([expired], () => undefined);
    const expiredSet = insertSet(fixture, {
      scope: 'pending',
      state: 'active',
      entityId: fixture.seeded.ids.hero ?? null,
      appearanceHash: hashOf(4),
      slots: slotsWith(expired.ref),
      updatedAt: fixture.now - (PORTRAIT_PREVIEW_TTL_DAYS + 1) * DAY_MS,
    });
    utimesSync(fixture.store.pathOf(expired.ref), oldTime() / 1000, oldTime() / 1000);

    const lockedBytes = pngBytes(6, 4);
    const locked = await fixture.store.stage(lockedBytes);
    await fixture.store.commit([locked], () => undefined);
    const lockedSet = insertSet(fixture, {
      scope: 'pending',
      state: 'active',
      entityId: fixture.seeded.ids.hero ?? null,
      appearanceHash: hashOf(5),
      slots: slotsWith(locked.ref),
      updatedAt: fixture.now - (PORTRAIT_PREVIEW_TTL_DAYS + 1) * DAY_MS,
    });
    utimesSync(fixture.store.pathOf(locked.ref), oldTime() / 1000, oldTime() / 1000);
    lockPlaythroughSet(fixture, lockedSet);

    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });

    expect(setExists(fixture, freshSet)).toBe(true);
    await expect(fixture.store.read(fresh.ref)).resolves.toEqual(Buffer.from(freshBytes));
    expect(setExists(fixture, expiredSet)).toBe(false);
    await expect(fixture.store.read(expired.ref)).resolves.toBeNull();
    expect(setExists(fixture, lockedSet)).toBe(true);
    await expect(fixture.store.read(locked.ref)).resolves.toEqual(Buffer.from(lockedBytes));
  });

  it('两部作品共享同一个文件，删掉一部后仍能读取', async () => {
    const fixture = setup();
    const other = seedStory(fixture.opened.db, {
      turns: [{ prose: '另一部作品的开场。' }],
      entities: [{ key: 'linOther', kind: 'character', name: '另一人' }],
    });
    const shared = fileRef(hashOf(91));
    insertSet(fixture, { slots: slotsWith(shared) });
    insertSet(fixture, {
      workId: other.workId,
      entityId: other.ids.linOther ?? null,
      appearanceHash: hashOf(92),
      slots: slotsWith(shared),
    });
    const path = writeBlob(fixture, shared.hash, oldTime());

    fixture.opened.db.delete(works).where(eq(works.id, fixture.seeded.workId)).run();
    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });
    expect(existsSync(path)).toBe(true);

    fixture.opened.db.delete(works).where(eq(works.id, other.workId)).run();
    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });
    expect(existsSync(path)).toBe(false);
  });

  it('方案里尚未确认的人物也算现有人物', async () => {
    const fixture = setup();
    const plannedId = randomUUID();
    fixture.opened.db.run(
      sql`update work_versions
          set meta = json_set(meta, '$.plan', json_object(
            'items', json_array(json_object('id', ${plannedId}, 'kind', 'entity', 'entityKind', 'character')),
            'conflicts', json_array(),
            'confirmedRev', null))
          where id = ${fixture.seeded.versionId}`,
    );
    const plannedRef = fileRef(hashOf(101));
    const plannedSet = insertSet(fixture, {
      entityId: plannedId,
      appearanceHash: hashOf(102),
      slots: slotsWith(plannedRef),
    });
    const plannedPath = writeBlob(fixture, plannedRef.hash, oldTime());

    const orphanRef = fileRef(hashOf(103));
    const orphanSet = insertSet(fixture, {
      entityId: randomUUID(),
      appearanceHash: hashOf(104),
      slots: slotsWith(orphanRef),
    });
    const orphanPath = writeBlob(fixture, orphanRef.hash, oldTime());

    await collectGarbage({ db: fixture.opened.db, store: fixture.store, now: fixture.now, logger: fixture.logger });

    expect(setExists(fixture, plannedSet)).toBe(true);
    expect(existsSync(plannedPath)).toBe(true);
    expect(setExists(fixture, orphanSet)).toBe(false);
    expect(existsSync(orphanPath)).toBe(false);
  });
});

describe('storageSummary', () => {
  it('同一个哈希被三处引用只算一次，孤儿文件不计入', () => {
    const fixture = setup();
    const ref = fileRef(hashOf(111), 500);
    insertSet(fixture, { state: 'draft', slots: slotsWith(ref), task: tasksWith({ inputFiles: [ref] }) });
    insertIllustration(fixture, 0, { file: ref });
    writeBlob(fixture, hashOf(112), oldTime(), 4_096);

    expect(referencedFiles(fixture.opened.db).size).toBe(1);
    expect(storageSummary(fixture.opened.db)).toEqual({ files: 1, bytes: 500 });
  });
});
