import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedNorthCape, seedStory } from '../test-support/story-fixtures.ts';
import { ancestorChain } from '../play/chain.ts';
import { openDatabase } from '../store/db.ts';
import { createCodeBook } from './codebook.ts';
import { loadProjection } from './projection.ts';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  return { temp, opened };
}

function projection(db: ReturnType<typeof openDatabase>['db'], versionId: string, headTurnId: string) {
  const chain = ancestorChain(db, headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  return loadProjection(db, { versionId, chain });
}

describe('createCodeBook', () => {
  it('主角永远是 @1', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const codebook = createCodeBook(projection(opened.db, seeded.versionId, seeded.headTurnId));
      expect(codebook.entityCode(seeded.ids.lin ?? '')).toBe('@1');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('没发过的编号被拒绝', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const codebook = createCodeBook(projection(opened.db, seeded.versionId, seeded.headTurnId));
      expect(codebook.resolveEntity('@99')).toEqual({ ok: false, error: '编号 @99 不是本次给出的编号。' });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同名时列出全部候选', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedStory(opened.db, {
        turns: [{ prose: '开场' }],
        entities: [
          { key: 'lin', kind: 'character', name: '主角', protagonist: true },
          { key: 'first', kind: 'character', name: '老周' },
          { key: 'second', kind: 'character', name: '老周' },
        ],
      });
      const codebook = createCodeBook(projection(opened.db, seeded.versionId, seeded.headTurnId));
      const first = codebook.entityCode(seeded.ids.first ?? '');
      const second = codebook.entityCode(seeded.ids.second ?? '');
      const result = codebook.resolveEntity('老周');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(first);
        expect(result.error).toContain(second);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('按主角的称呼也能找到', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const codebook = createCodeBook(projection(opened.db, seeded.versionId, seeded.headTurnId));
      codebook.entityCode(seeded.ids.shen ?? '');
      expect(codebook.resolveEntity('撑伞的女人')).toEqual({ ok: true, id: seeded.ids.shen });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
