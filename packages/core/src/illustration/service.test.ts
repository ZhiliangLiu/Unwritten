import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_MAX_LENGTH, type CoreEvent, type IllustrationStyle } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import { createImageService } from '../image/service.ts';
import { createLibraryService } from '../library/service.ts';
import type { Logger, LogEvent } from '../log/logger.ts';
import type { ImageFileRef, PortraitSlotsStored } from '../store/illustration-types.ts';
import { openDatabase } from '../store/db.ts';
import { portraitSets, workVersions, works } from '../store/schema.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { seedLighthouseTown } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { IMAGE_GC_GRACE_MS } from './constants.ts';
import { createIllustrationService } from './service.ts';

function createLogger(): { logger: Logger; events: LogEvent[] } {
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

function slotsWith(front: ImageFileRef | null): PortraitSlotsStored {
  return {
    front: { file: front, source: front ? 'generate' : null, needsReview: false },
    three_quarter: { file: null, source: null, needsReview: false },
    full_body: { file: null, source: null, needsReview: false },
  };
}

function fileRef(hash: string, bytes: number): ImageFileRef {
  return { hash, mime: 'image/png', width: 4, height: 4, bytes };
}

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = seedLighthouseTown(opened.db);
  const { logger, events } = createLogger();
  const published: CoreEvent[] = [];
  const bus = createEventBus();
  const llm = createScriptedLlm();
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
    logger,
    shutdown: new AbortController().signal,
  };
  const image = createImageService({ ...deps, llm });
  const illustration = createIllustrationService({ ...deps, llm, image });
  const library = createLibraryService(deps);
  return { temp, opened, seeded, events, published, illustration, library, llm };
}

function insertSet(
  opened: ReturnType<typeof setup>['opened'],
  workId: string,
  input: { slots: PortraitSlotsStored; updatedAt?: number; entityId?: string },
) {
  const id = randomUUID();
  opened.db
    .insert(portraitSets)
    .values({
      id,
      workId,
      scope: 'work',
      playthroughId: null,
      entityId: input.entityId ?? randomUUID(),
      appearanceFactId: null,
      appearanceHash: 'a'.repeat(64),
      appearance: '虚构形象',
      style: { kind: 'preset', preset: 'painterly' },
      state: 'active',
      draftRev: 0,
      slots: input.slots,
      task: null,
      createdAt: input.updatedAt ?? Date.now(),
      updatedAt: input.updatedAt ?? Date.now(),
    })
    .run();
  return id;
}

describe('createIllustrationService', () => {
  it('setWorkStyle 只改作品画风，不动草稿修订号，并发布 works.changed', () => {
    const fixture = setup();
    try {
      const { opened, seeded, illustration, library, published } = fixture;
      const style: IllustrationStyle = { kind: 'custom', text: '旧照片的颗粒感' };
      const before = opened.db.select().from(works).where(eq(works.id, seeded.workId)).get()!;
      const draftRevBefore = opened.db
        .select()
        .from(workVersions)
        .where(eq(workVersions.id, seeded.draftVersionId!))
        .get()!.contentRev;
      const publishedRevBefore = opened.db
        .select()
        .from(workVersions)
        .where(eq(workVersions.id, seeded.versionId))
        .get()!.contentRev;
      expect(library.get({ workId: seeded.workId }).illustrationStyle).toBeNull();

      illustration.setWorkStyle({ workId: seeded.workId, style });

      const after = opened.db.select().from(works).where(eq(works.id, seeded.workId)).get()!;
      expect(after.illustrationStyle).toEqual(style);
      expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
      expect(library.get({ workId: seeded.workId }).illustrationStyle).toEqual(style);
      expect(
        opened.db.select().from(workVersions).where(eq(workVersions.id, seeded.draftVersionId!)).get()!.contentRev,
      ).toBe(draftRevBefore);
      expect(opened.db.select().from(workVersions).where(eq(workVersions.id, seeded.versionId)).get()!.contentRev).toBe(
        publishedRevBefore,
      );
      expect(published.filter((event) => event.type === 'works.changed')).toEqual([
        { type: 'works.changed', workId: seeded.workId },
      ]);
    } finally {
      fixture.opened.close();
      fixture.temp.cleanup();
    }
  });

  it('按设定写形象不合格时接口收到 invalid_output 错误码', async () => {
    const fixture = setup();
    try {
      const tooLong = '衣'.repeat(APPEARANCE_MAX_LENGTH + 1);
      fixture.llm.enqueue({ text: tooLong }, { text: tooLong }, { text: tooLong });
      let error: unknown;
      try {
        await fixture.illustration.suggestAppearance({ workId: fixture.seeded.workId });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: 'invalid_output' });
      expect(fixture.llm.completes).toHaveLength(3);
    } finally {
      fixture.opened.close();
      fixture.temp.cleanup();
    }
  });

  it('storageSummary 按去重后的文件计算占用', () => {
    const fixture = setup();
    try {
      const { opened, seeded, illustration } = fixture;
      const shared = fileRef('b'.repeat(64), 500);
      insertSet(opened, seeded.workId, { slots: slotsWith(shared) });
      insertSet(opened, seeded.workId, { slots: slotsWith(shared) });
      insertSet(opened, seeded.workId, { slots: slotsWith(fileRef('c'.repeat(64), 300)) });
      expect(illustration.storageSummary()).toEqual({ files: 2, bytes: 800 });
    } finally {
      fixture.opened.close();
      fixture.temp.cleanup();
    }
  });

  it('collectGarbage 删除超过保护期的孤儿文件，保留被引用的文件', async () => {
    const fixture = setup();
    try {
      const { opened, seeded, illustration, events } = fixture;
      const now = Date.now();
      const old = now - IMAGE_GC_GRACE_MS - 1_000;
      const orphan = fileRef('d'.repeat(64), 32);
      const referenced = fileRef('e'.repeat(64), 48);
      const blobs = join(fixture.temp.dir, 'images', 'blobs');
      const writeBlob = (ref: ImageFileRef) => {
        const path = join(blobs, `${ref.hash}.png`);
        writeFileSync(path, Buffer.alloc(ref.bytes, 7));
        utimesSync(path, old / 1000, old / 1000);
        return path;
      };
      const orphanPath = writeBlob(orphan);
      const referencedPath = writeBlob(referenced);
      insertSet(opened, seeded.workId, {
        slots: slotsWith(referenced),
        updatedAt: old,
        entityId: seeded.ids.linchao!,
      });

      await illustration.collectGarbage();

      expect(existsSync(orphanPath)).toBe(false);
      expect(existsSync(referencedPath)).toBe(true);
      expect(events.some((event) => event.event === 'image.gc')).toBe(true);
    } finally {
      fixture.opened.close();
      fixture.temp.cleanup();
    }
  });
});
