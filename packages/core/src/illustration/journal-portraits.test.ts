import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ImageFileRef, PortraitSlotsStored } from '../store/illustration-types.ts';
import { TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION } from '../store/illustration-types.ts';
import { portraitSets } from '../store/schema.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { ancestorChain } from '../play/chain.ts';
import { pngBytes } from '../test-support/image-bytes.ts';
import { seedStory, type SeededStory } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { journalPortraits } from './journal-portraits.ts';
import { createImageStore, type ImageStore } from './storage.ts';
import { loadProjection } from '../story/projection.ts';
import type { StoryProjection } from '../story/types.ts';

function slotsWith(front: ImageFileRef | null): PortraitSlotsStored {
  return {
    front: { file: front, source: front === null ? null : 'generate', needsReview: false },
    three_quarter: { file: null, source: null, needsReview: false },
    full_body: { file: null, source: null, needsReview: false },
  };
}

async function readyRef(store: ImageStore, bytes: Uint8Array): Promise<ImageFileRef> {
  const staged = await store.stage(bytes);
  await store.commit([staged], () => undefined);
  return staged.ref;
}

function insertWorkSet(
  db: Database,
  input: { workId: string; entityId: string; front: ImageFileRef | null; updatedAt: number },
): string {
  const id = randomUUID();
  db.insert(portraitSets)
    .values({
      id,
      workId: input.workId,
      scope: 'work',
      playthroughId: null,
      entityId: input.entityId,
      appearanceFactId: null,
      appearanceHash: randomUUID(),
      appearance: '虚构形象',
      style: { kind: 'preset', preset: 'painterly' },
      state: 'active',
      draftRev: 0,
      slots: slotsWith(input.front),
      task: null,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
    })
    .run();
  return id;
}

function insertPlaythroughSet(
  db: Database,
  input: {
    workId: string;
    playthroughId: string;
    entityId: string;
    appearanceFactId: string | null;
    front: ImageFileRef | null;
    updatedAt: number;
  },
): string {
  const id = randomUUID();
  db.insert(portraitSets)
    .values({
      id,
      workId: input.workId,
      scope: 'playthrough',
      playthroughId: input.playthroughId,
      entityId: input.entityId,
      appearanceFactId: input.appearanceFactId,
      appearanceHash: randomUUID(),
      appearance: '虚构形象',
      style: { kind: 'preset', preset: 'painterly' },
      state: 'draft',
      draftRev: 0,
      slots: slotsWith(input.front),
      task: null,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
    })
    .run();
  return id;
}

function projectionOf(db: Database, seeded: SeededStory): StoryProjection {
  const chain = ancestorChain(db, seeded.headTurnId).map((turn) => ({
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

async function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const store = createImageStore(temp.dir);
  return { temp, opened, store };
}

describe('journalPortraits', () => {
  it('只听说过的人没有缩略图，见过的人有', async () => {
    const { temp, opened, store } = await setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场。', place: '码头', presentKeys: ['zhou'] }],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'shen', kind: 'character', name: '沈岚' },
          { key: 'zhou', kind: 'character', name: '老周' },
        ],
        names: [
          { entity: 'shen', name: '沈岚', holder: 'lin', originTurn: 0, para: 1 },
          { entity: 'zhou', name: '老周', holder: 'lin', originTurn: 0, para: 1 },
        ],
        facts: [
          {
            key: 'heardShen',
            kind: 'relation',
            subject: 'lin',
            object: 'shen',
            factKey: 'acquaintance',
            statement: '听说沈岚在码头',
            data: { stage: 'heard' },
            originTurn: 0,
            para: 1,
          },
          {
            key: 'metZhou',
            kind: 'relation',
            subject: 'lin',
            object: 'zhou',
            factKey: 'acquaintance',
            statement: '林远见过老周',
            data: { stage: 'met' },
            originTurn: 0,
            para: 1,
          },
        ],
      });
      const front = await readyRef(store, pngBytes(4, 4));
      const shenSet = insertWorkSet(opened.db, {
        workId: seeded.workId,
        entityId: seeded.ids.shen ?? '',
        front,
        updatedAt: 1_700_000_000_000,
      });
      const zhouSet = insertWorkSet(opened.db, {
        workId: seeded.workId,
        entityId: seeded.ids.zhou ?? '',
        front,
        updatedAt: 1_700_000_000_001,
      });
      const map = journalPortraits(opened.db, {
        routeId: seeded.routeId,
        projection: projectionOf(opened.db, seeded),
        settings: settingsWith({
          [seeded.ids.shen ?? '']: shenSet,
          [seeded.ids.zhou ?? '']: zhouSet,
        }),
        playthroughId: seeded.playthroughId,
      });
      expect(map.has(seeded.ids.shen ?? '')).toBe(false);
      expect(map.get(seeded.ids.zhou ?? '')).toEqual({ setId: zhouSet, updatedAt: 1_700_000_000_001 });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('见过的人用本局锁定的作者组正面', async () => {
    const { temp, opened, store } = await setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场。', place: '码头' }],
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
            originTurn: 0,
            para: 1,
          },
        ],
      });
      const front = await readyRef(store, pngBytes(4, 4));
      const setId = insertWorkSet(opened.db, {
        workId: seeded.workId,
        entityId: seeded.ids.shen ?? '',
        front,
        updatedAt: 1_700_000_000_000,
      });
      const map = journalPortraits(opened.db, {
        routeId: seeded.routeId,
        projection: projectionOf(opened.db, seeded),
        settings: settingsWith({ [seeded.ids.shen ?? '']: setId }),
        playthroughId: seeded.playthroughId,
      });
      expect(map.get(seeded.ids.shen ?? '')).toEqual({ setId, updatedAt: 1_700_000_000_000 });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('换装带 same_visible_identity 后仍用原基础组的正面', async () => {
    const { temp, opened, store } = await setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '开场。', place: '大厅', presentKeys: ['shen'] },
          { prose: '第一段。\n\n第二段，她换了衣服。', place: '大厅', presentKeys: ['shen'] },
        ],
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
            statement: '林远在大厅见到沈岚',
            data: { stage: 'met' },
            originTurn: 0,
            para: 1,
          },
          {
            key: 'shenOld',
            kind: 'trait',
            subject: 'shen',
            factKey: 'appearance',
            statement: '深灰旧风衣',
            originTurn: 0,
            para: 1,
          },
          {
            key: 'shenNew',
            kind: 'trait',
            subject: 'shen',
            factKey: 'appearance',
            statement: '白围裙',
            data: { same_visible_identity: 1 },
            originTurn: 1,
            para: 2,
          },
        ],
      });
      const front = await readyRef(store, pngBytes(4, 4));
      const authorSet = insertWorkSet(opened.db, {
        workId: seeded.workId,
        entityId: seeded.ids.shen ?? '',
        front,
        updatedAt: 1_700_000_000_000,
      });
      const baseSet = insertPlaythroughSet(opened.db, {
        workId: seeded.workId,
        playthroughId: seeded.playthroughId,
        entityId: seeded.ids.shen ?? '',
        appearanceFactId: seeded.ids.shenOld ?? '',
        front,
        updatedAt: 1_700_000_000_001,
      });
      const changedSet = insertPlaythroughSet(opened.db, {
        workId: seeded.workId,
        playthroughId: seeded.playthroughId,
        entityId: seeded.ids.shen ?? '',
        appearanceFactId: seeded.ids.shenNew ?? '',
        front,
        updatedAt: 1_700_000_000_002,
      });
      const map = journalPortraits(opened.db, {
        routeId: seeded.routeId,
        projection: projectionOf(opened.db, seeded),
        settings: settingsWith({ [seeded.ids.shen ?? '']: authorSet }),
        playthroughId: seeded.playthroughId,
      });
      expect(changedSet).not.toBe(baseSet);
      expect(authorSet).not.toBe(baseSet);
      expect(map.get(seeded.ids.shen ?? '')).toEqual({ setId: baseSet, updatedAt: 1_700_000_000_001 });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('插图未启用的开局不返回缩略图', async () => {
    const { temp, opened, store } = await setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场。', place: '码头' }],
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
            statement: '林远见到沈岚',
            data: { stage: 'met' },
            originTurn: 0,
            para: 1,
          },
        ],
      });
      const front = await readyRef(store, pngBytes(4, 4));
      const setId = insertWorkSet(opened.db, {
        workId: seeded.workId,
        entityId: seeded.ids.shen ?? '',
        front,
        updatedAt: 1_700_000_000_000,
      });
      const enabled = settingsWith({ [seeded.ids.shen ?? '']: setId });
      const enabledMap = journalPortraits(opened.db, {
        routeId: seeded.routeId,
        projection: projectionOf(opened.db, seeded),
        settings: enabled,
        playthroughId: seeded.playthroughId,
      });
      expect(enabledMap.size).toBe(1);
      const map = journalPortraits(opened.db, {
        routeId: seeded.routeId,
        projection: projectionOf(opened.db, seeded),
        settings: { ...enabled, enabled: false },
        playthroughId: seeded.playthroughId,
      });
      expect(map.size).toBe(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('组里没有正面就不返回缩略图', async () => {
    const { temp, opened, store } = await setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场。' }],
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
            statement: '林远见到沈岚',
            data: { stage: 'met' },
            originTurn: 0,
            para: 1,
          },
        ],
      });
      const setId = insertWorkSet(opened.db, {
        workId: seeded.workId,
        entityId: seeded.ids.shen ?? '',
        front: null,
        updatedAt: 1_700_000_000_000,
      });
      const withFront = insertWorkSet(opened.db, {
        workId: seeded.workId,
        entityId: seeded.ids.shen ?? '',
        front: await readyRef(store, pngBytes(4, 4)),
        updatedAt: 1_700_000_000_001,
      });
      const readyMap = journalPortraits(opened.db, {
        routeId: seeded.routeId,
        projection: projectionOf(opened.db, seeded),
        settings: settingsWith({ [seeded.ids.shen ?? '']: withFront }),
        playthroughId: seeded.playthroughId,
      });
      expect(readyMap.size).toBe(1);
      const map = journalPortraits(opened.db, {
        routeId: seeded.routeId,
        projection: projectionOf(opened.db, seeded),
        settings: settingsWith({ [seeded.ids.shen ?? '']: setId }),
        playthroughId: seeded.playthroughId,
      });
      expect(map.size).toBe(0);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
