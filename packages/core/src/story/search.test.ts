import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedStory } from '../test-support/story-fixtures.ts';
import { ancestorChain } from '../play/chain.ts';
import { openDatabase } from '../store/db.ts';
import { loadProjection } from './projection.ts';
import { searchStory } from './search.ts';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  return { temp, opened };
}

describe('searchStory', () => {
  it('三个字以上走全文检索，只看祖先链', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [
          { prose: '灯塔守夜人在渡口等船' },
          { prose: '守夜人把灯点上', action: '走近' },
          { prose: '守夜人没有来', action: '走另一条路', parent: 0 },
        ],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      const projectionFor = (head: string) => {
        const chain = ancestorChain(opened.db, head).map((turn) => ({
          id: turn.id,
          depth: turn.depth,
          action: turn.action,
          prose: turn.prose,
          scene: turn.scene,
        }));
        return loadProjection(opened.db, { versionId: seeded.versionId, chain });
      };
      const hits = searchStory(opened.db, projectionFor(seeded.turnIds[1] ?? ''), '守夜人');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.map((hit) => hit.turnId)).toEqual([seeded.turnIds[1], seeded.turnIds[0]]);
      expect(hits.map((hit) => hit.turnId)).not.toContain(seeded.turnIds[2]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('一两个字走子串扫描', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '灯亮着。\n\n有人走过。' }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      const chain = ancestorChain(opened.db, seeded.headTurnId).map((turn) => ({
        id: turn.id,
        depth: turn.depth,
        action: turn.action,
        prose: turn.prose,
        scene: turn.scene,
      }));
      const projection = loadProjection(opened.db, { versionId: seeded.versionId, chain });
      expect(searchStory(opened.db, projection, '灯')).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('查询里的引号不会让检索报错', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '他说“等等”。' }],
        entities: [{ key: 'lin', kind: 'character', name: '林远', protagonist: true }],
      });
      const chain = ancestorChain(opened.db, seeded.headTurnId).map((turn) => ({
        id: turn.id,
        depth: turn.depth,
        action: turn.action,
        prose: turn.prose,
        scene: turn.scene,
      }));
      const projection = loadProjection(opened.db, { versionId: seeded.versionId, chain });
      expect(() => searchStory(opened.db, projection, '他说"等等"')).not.toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
