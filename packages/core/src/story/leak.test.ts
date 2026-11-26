import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedNorthCape, seedStory } from '../test-support/story-fixtures.ts';
import { ancestorChain } from '../play/chain.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { loadProjection } from './projection.ts';
import { findLeaks } from './leak.ts';
import { EMPTY_CHANGES, type ValidatedChanges } from './types.ts';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  return { temp, opened };
}

function projectionAt(db: Database, versionId: string, headTurnId: string) {
  const chain = ancestorChain(db, headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  return loadProjection(db, { versionId, chain });
}

function withName(seeded: { ids: Record<string, string> }, name: string, para: number): ValidatedChanges {
  return {
    ...EMPTY_CHANGES,
    names: [
      {
        line: 1,
        entity: { existing: seeded.ids.shen ?? '' },
        name,
        holder: { existing: seeded.ids.lin ?? '' },
        para,
      },
    ],
  };
}

describe('findLeaks', () => {
  it('正文提前出现真名被拦下', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db, { head: 1 });
      const projection = projectionAt(opened.db, seeded.versionId, seeded.headTurnId);
      const realName = '沈岚';
      const errors = findLeaks({
        projection,
        changes: EMPTY_CHANGES,
        paragraphs: ['第一段没有名字', `第二段出现了${realName}`],
        options: [],
      });
      expect(errors.some((error) => error.includes('第 2 段'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一段里先给称呼就不算泄露', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db, { head: 1 });
      const projection = projectionAt(opened.db, seeded.versionId, seeded.headTurnId);
      const errors = findLeaks({
        projection,
        changes: withName(seeded, '沈岚', 2),
        paragraphs: ['第一段', '沈岚走来'],
        options: [],
      });
      expect(errors).toEqual([]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('推荐行动里的真名被拦下', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db, { head: 1 });
      const projection = projectionAt(opened.db, seeded.versionId, seeded.headTurnId);
      const errors = findLeaks({
        projection,
        changes: EMPTY_CHANGES,
        paragraphs: ['第一段'],
        options: ['去问沈岚'],
      });
      expect(errors.some((error) => error.includes('推荐行动'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('长称呼包着短真名时不误报', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [
          { key: 'lin', kind: 'character', name: '林远', protagonist: true },
          { key: 'zhou', kind: 'character', name: '老周' },
        ],
        names: [{ entity: 'zhou', name: '老周头', holder: 'lin', originTurn: 0, para: 1 }],
      });
      const projection = projectionAt(opened.db, seeded.versionId, seeded.headTurnId);
      expect(findLeaks({ projection, changes: EMPTY_CHANGES, paragraphs: ['老周头站在门口'], options: [] })).toEqual(
        [],
      );
      expect(findLeaks({ projection, changes: EMPTY_CHANGES, paragraphs: ['老周站在门口'], options: [] })).not.toEqual(
        [],
      );
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一段里的遗漏名字一次报全，并指向已登记的叫法', () => {
    const changes: ValidatedChanges = {
      ...EMPTY_CHANGES,
      entities: [
        { line: 1, kind: 'item', name: '密信', knownAs: '那封信', profile: '', para: 1, protagonist: false },
        { line: 2, kind: 'item', name: '黑豆仓', knownAs: '半仓黑豆', profile: '', para: 1, protagonist: false },
      ],
    };
    const errors = findLeaks({
      projection: null,
      changes,
      paragraphs: ['你把密信塞回袋中，又看了一眼黑豆仓'],
      options: [],
    });
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toContain('那封信');
    expect(errors.join('\n')).toContain('半仓黑豆');
  });

  it('开场里主角自己的名字不算泄露', () => {
    const { temp, opened } = setup();
    try {
      const changes: ValidatedChanges = {
        ...EMPTY_CHANGES,
        entities: [
          {
            line: 1,
            kind: 'character',
            name: '林远',
            knownAs: null,
            profile: '',
            para: 1,
            protagonist: true,
          },
        ],
      };
      expect(findLeaks({ projection: null, changes, paragraphs: ['林远醒了过来'], options: [] })).toEqual([]);
      expect(opened).toBeTruthy();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
