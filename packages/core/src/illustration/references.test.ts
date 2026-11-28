import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PortraitSlot } from '@unwritten/contracts';
import type { ScenePerson } from '../story/scene-projection.ts';
import { openDatabase } from '../store/db.ts';
import {
  EMPTY_PORTRAIT_SLOTS,
  PlaythroughIllustrationSchema,
  PortraitSlotsStoredSchema,
  TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION,
  type ImageFileRef,
  type PlaythroughIllustration,
} from '../store/illustration-types.ts';
import { portraitSets } from '../store/schema.ts';
import { seedNorthCape, type SeededStory } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import type { PortraitDeps } from './portraits.ts';
import { pickReferenceFiles, referenceViewsFor } from './references.ts';
import { dropReference } from './shot-compose.ts';

function fileRef(hash: string): ImageFileRef {
  return { hash: hash.repeat(64).slice(0, 64), mime: 'image/png', width: 8, height: 8, bytes: 32 };
}

function slots(filled: Partial<Record<PortraitSlot, ImageFileRef>>) {
  return PortraitSlotsStoredSchema.parse({
    ...EMPTY_PORTRAIT_SLOTS,
    front: { file: filled.front ?? null, source: filled.front ? 'generate' : null, needsReview: false },
    three_quarter: {
      file: filled.three_quarter ?? null,
      source: filled.three_quarter ? 'generate' : null,
      needsReview: false,
    },
    full_body: { file: filled.full_body ?? null, source: filled.full_body ? 'generate' : null, needsReview: false },
  });
}

function person(overrides: Partial<ScenePerson> & { entityId: string }): ScenePerson {
  return {
    code: 'C1',
    knownAs: null,
    appearance: null,
    identityFactId: null,
    isProtagonist: false,
    ...overrides,
  };
}

function settingsWith(overrides: Partial<PlaythroughIllustration> = {}): PlaythroughIllustration {
  return PlaythroughIllustrationSchema.parse({
    ...TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION,
    enabled: true,
    ...overrides,
  });
}

function insertSet(
  opened: ReturnType<typeof openDatabase>,
  seeded: SeededStory,
  input: {
    entityId: string;
    scope: 'work' | 'playthrough' | 'pending';
    playthroughId?: string | null;
    appearanceFactId?: string | null;
    filled: Partial<Record<PortraitSlot, ImageFileRef>>;
  },
): string {
  const id = randomUUID();
  opened.db
    .insert(portraitSets)
    .values({
      id,
      workId: seeded.workId,
      scope: input.scope,
      playthroughId: input.playthroughId ?? null,
      entityId: input.entityId,
      appearanceFactId: input.appearanceFactId ?? null,
      appearanceHash: 'a'.repeat(64),
      appearance: '虚构形象',
      style: { kind: 'preset', preset: 'painterly' },
      state: 'active',
      draftRev: 0,
      slots: slots(input.filled),
      task: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return id;
}

describe('referenceViewsFor', () => {
  it('主角用本局快照的组，其他人物用作者组或路线上的组', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    const seeded = seedNorthCape(opened.db);
    const protagonistId = seeded.ids.lin!;
    const shenId = seeded.ids.shen!;
    const zhouId = seeded.ids.zhou!;
    try {
      const protagonistSet = insertSet(opened, seeded, {
        entityId: protagonistId,
        scope: 'pending',
        filled: { front: fileRef('1') },
      });
      const authorSet = insertSet(opened, seeded, {
        entityId: shenId,
        scope: 'work',
        filled: { front: fileRef('2'), full_body: fileRef('3') },
      });
      insertSet(opened, seeded, {
        entityId: zhouId,
        scope: 'playthrough',
        playthroughId: seeded.playthroughId,
        appearanceFactId: 'fact-1',
        filled: { three_quarter: fileRef('4') },
      });
      const settings = settingsWith({
        protagonistPortraitSetId: protagonistSet,
        authorPortraitSetIds: { [shenId]: authorSet },
      });

      const views = referenceViewsFor(opened.db, {
        people: [
          person({ code: 'C1', entityId: protagonistId, isProtagonist: true }),
          person({ code: 'C2', entityId: shenId }),
          person({ code: 'C3', entityId: zhouId, identityFactId: 'fact-1' }),
        ],
        settings,
        playthroughId: seeded.playthroughId,
        maxReferences: 4,
      });

      expect(views).toEqual({
        C1: ['front'],
        C2: ['front', 'full_body'],
        C3: ['three_quarter'],
      });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('没有组但有可见形象时按正面可现画；服务不收参考图时不给位置', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    const seeded = seedNorthCape(opened.db);
    try {
      const people = [
        person({ code: 'C1', entityId: seeded.ids.shen!, appearance: '短发，深色外套' }),
        person({ code: 'C2', entityId: seeded.ids.zhou! }),
      ];
      expect(
        referenceViewsFor(opened.db, {
          people,
          settings: settingsWith(),
          playthroughId: seeded.playthroughId,
          maxReferences: 4,
        }),
      ).toEqual({ C1: ['front'] });
      insertSet(opened, seeded, {
        entityId: seeded.ids.zhou!,
        scope: 'work',
        filled: { front: fileRef('6') },
      });
      expect(
        referenceViewsFor(opened.db, {
          people,
          settings: settingsWith(),
          playthroughId: seeded.playthroughId,
          maxReferences: 0,
        }),
      ).toEqual({});
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('主角没有快照时回落到作者参考组，快照仍然优先', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    const seeded = seedNorthCape(opened.db);
    const protagonistId = seeded.ids.lin!;
    try {
      const authorSet = insertSet(opened, seeded, {
        entityId: protagonistId,
        scope: 'work',
        filled: { front: fileRef('7') },
      });
      const snapshot = insertSet(opened, seeded, {
        entityId: protagonistId,
        scope: 'pending',
        filled: { three_quarter: fileRef('8') },
      });
      const people = [person({ code: 'C1', entityId: protagonistId, isProtagonist: true })];
      expect(
        referenceViewsFor(opened.db, {
          people,
          settings: settingsWith({ authorPortraitSetIds: { [protagonistId]: authorSet } }),
          playthroughId: seeded.playthroughId,
          maxReferences: 4,
        }),
      ).toEqual({ C1: ['front'] });
      expect(
        referenceViewsFor(opened.db, {
          people,
          settings: settingsWith({
            authorPortraitSetIds: { [protagonistId]: authorSet },
            protagonistPortraitSetId: snapshot,
          }),
          playthroughId: seeded.playthroughId,
          maxReferences: 4,
        }),
      ).toEqual({ C1: ['three_quarter'] });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('改写成文字时不用真名，先用称呼，称呼也是真名时用「一个人」', async () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    const seeded = seedNorthCape(opened.db);
    try {
      const people = [
        person({ code: 'C1', entityId: seeded.ids.shen!, knownAs: '沈岚' }),
        person({ code: 'C2', entityId: seeded.ids.zhou!, knownAs: '撑伞的女人' }),
      ];
      const result = await pickReferenceFiles({ db: opened.db } as unknown as PortraitDeps, {
        refs: [
          { code: 'C1', view: 'front' },
          { code: 'C2', view: 'front' },
        ],
        people,
        settings: settingsWith(),
        playthroughId: seeded.playthroughId,
        workId: seeded.workId,
        serviceId: 'image-a',
        guard: { model: null, assertCurrent() {} },
        maxReferenceBytes: null,
        bannedNames: ['沈岚'],
        signal: new AbortController().signal,
      });
      expect(result).toEqual([
        { code: 'C1', drop: '一个人' },
        { code: 'C2', drop: '撑伞的女人' },
      ]);
      const replacement = 'drop' in result[0]! ? result[0]!.drop : '';
      const rewritten = dropReference(
        'A figure hands over a key to {{ref:1}}.',
        [{ code: 'C1', view: 'front' }],
        0,
        replacement,
      );
      expect(rewritten.prompt.toLowerCase()).not.toContain('沈岚');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('冻结的组 id 过期或属于别的人物时，回落到路线上的组', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    const seeded = seedNorthCape(opened.db);
    const shenId = seeded.ids.shen!;
    try {
      insertSet(opened, seeded, {
        entityId: shenId,
        scope: 'playthrough',
        playthroughId: seeded.playthroughId,
        filled: { front: fileRef('5') },
      });
      const views = referenceViewsFor(opened.db, {
        people: [person({ code: 'C1', entityId: shenId, appearance: '短发' })],
        settings: settingsWith({ authorPortraitSetIds: { [shenId]: randomUUID() } }),
        playthroughId: seeded.playthroughId,
        maxReferences: 4,
      });
      expect(views).toEqual({ C1: ['front'] });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
