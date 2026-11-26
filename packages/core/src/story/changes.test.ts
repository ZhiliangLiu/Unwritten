import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedNorthCape } from '../test-support/story-fixtures.ts';
import { changeLines } from '../test-support/llm-steps.ts';
import { ancestorChain } from '../play/chain.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { createCodeBook } from './codebook.ts';
import { loadProjection, presentIdsAtHead } from './projection.ts';
import { parseChanges, type ChangesContext } from './changes.ts';
import { EMPTY_CHANGES } from './types.ts';

function opening(paragraphCount = 1): ChangesContext {
  return {
    mode: 'opening',
    projection: null,
    codebook: null,
    paragraphCount,
    parentPresentIds: [],
  };
}

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  return { temp, opened };
}

function turnContext(db: Database, versionId: string, headTurnId: string, parentPresentIds?: string[]): ChangesContext {
  const chain = ancestorChain(db, headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  const projection = loadProjection(db, { versionId, chain });
  const codebook = createCodeBook(projection);
  for (const entity of projection.entities.values()) codebook.entityCode(entity.id);
  for (const fact of projection.facts) codebook.factCode(fact.id);
  return {
    mode: 'turn',
    projection,
    codebook,
    paragraphCount: 2,
    parentPresentIds: parentPresentIds ?? presentIdsAtHead(projection),
  };
}

describe('parseChanges', () => {
  it('空字符串得到空变化', () => {
    const result = parseChanges('', opening());
    expect(result).toEqual({ ok: true, value: EMPTY_CHANGES });
  });

  it('不支持的类型被拒绝，并列出可用类型', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges('{"type":"state"}', turnContext(opened.db, seeded.versionId, seeded.headTurnId));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]).toContain('第 1 行 changes：不支持的类型 state');
        expect(result.errors[0]).toContain('scene');
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场必须恰好有一个主角', () => {
    const noProtagonist = parseChanges(
      '{"type":"new_entity","kind":"character","name":"守夜人","profile":"","para":"1"}',
      opening(),
    );
    expect(noProtagonist.ok).toBe(false);
    if (!noProtagonist.ok) expect(noProtagonist.errors[0]).toContain('开场必须有一行');
    const withProtagonist = parseChanges(
      changeLines(
        {
          type: 'new_entity',
          kind: 'character',
          name: '守夜人',
          known_as: '',
          profile: '',
          para: '1',
          protagonist: 'true',
        },
        { type: 'new_entity', kind: 'character', name: '沈岚', known_as: '撑伞的女人', profile: '', para: '1' },
      ),
      opening(),
    );
    expect(withProtagonist.ok).toBe(true);
  });

  it('续写时不能新增主角', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        '{"type":"new_entity","kind":"character","name":"另一个人","profile":"","para":"1","protagonist":"true"}',
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toContain('续写时不能新增主角');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同名新人物必须声明 distinct 并写明区别', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const context = turnContext(opened.db, seeded.versionId, seeded.headTurnId);
      const rejected = parseChanges(
        '{"type":"new_entity","kind":"character","name":"沈岚","profile":"另一个沈岚","para":"1"}',
        context,
      );
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.errors[0]).toContain('同名');
      const accepted = parseChanges(
        '{"type":"new_entity","kind":"character","name":"沈岚","profile":"另一个沈岚，穿红伞","para":"1","distinct":"true"}',
        context,
      );
      expect(accepted.ok).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一次重复新增同一个名字被拒绝', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        changeLines(
          { type: 'new_entity', kind: 'character', name: '守夜人', profile: '', para: '1' },
          { type: 'new_entity', kind: 'character', name: '守夜人', profile: '', para: '2' },
        ),
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((error) => error.includes('重复新增了同一个名字'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('引用没发过的编号被拒绝', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        '{"type":"event","subject":"@99","statement":"有人来了","witnesses":"@1","para":"1"}',
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toContain('不是本次给出的编号');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('可以按名字引用本次新增的人物', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        changeLines(
          { type: 'new_entity', kind: 'character', name: '守夜人', profile: '', para: '1' },
          {
            type: 'event',
            subject: '守夜人',
            statement: '守夜人点亮了灯',
            witnesses: '@1',
            para: '1',
          },
        ),
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('省略目击者时默认父回合在场者加主角', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const context = turnContext(opened.db, seeded.versionId, seeded.headTurnId);
      const result = parseChanges('{"type":"event","subject":"@1","statement":"有人来了","para":"1"}', {
        ...context,
        parentPresentIds: [seeded.ids.shen ?? ''],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.facts[0]?.witnesses).toEqual([{ existing: seeded.ids.lin }, { existing: seeded.ids.shen }]);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('场景变化时必须写明目击者', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        changeLines(
          { type: 'event', subject: '@1', statement: '有人来了', para: '1' },
          { type: 'scene', place: '门外', time: '夜里', present: '@2' },
        ),
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((error) => error.includes('必须写明目击者'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('不在场又没写来源的知情被拒绝', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const context = turnContext(opened.db, seeded.versionId, seeded.headTurnId, [seeded.ids.shen ?? '']);
      const rejected = parseChanges(
        '{"type":"knowledge","fact":"#1","holder":"@3","level":"confirmed","para":"1"}',
        context,
      );
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.errors[0]).toContain('本回合不在场');
      const accepted = parseChanges(
        '{"type":"knowledge","fact":"#1","holder":"@3","level":"confirmed","via":"@2","para":"1"}',
        context,
      );
      expect(accepted.ok).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('未确认的知情必须写主角听到的说法', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        '{"type":"knowledge","fact":"#1","holder":"@1","level":"heard","para":"1"}',
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toContain('必须写主角听到的说法');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('行号引用被拒绝', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        changeLines(
          { type: 'name', entity: '@2', name: '沈岚', holder: '@1', para: '1' },
          { type: 'knowledge', fact: 'L1', holder: '@1', level: 'confirmed', para: '1' },
        ),
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toContain('changes.fact');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('续写也能引用本次事实行自己起的 id', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        changeLines(
          {
            type: 'event',
            subject: '@2',
            statement: '她把伞递给他',
            witnesses: '@1,@2',
            para: '1',
            id: '递伞',
          },
          { type: 'knowledge', fact: '递伞', holder: '@1', level: 'confirmed', para: '1' },
        ),
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.knowledge[0]?.fact).toEqual({ line: 1 });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('事实行都没起 id 时，报错说明怎么起', () => {
    const result = parseChanges(
      changeLines(
        {
          type: 'new_entity',
          kind: 'character',
          name: '驿丞',
          known_as: '',
          profile: '',
          para: '1',
          protagonist: 'true',
        },
        { type: 'event', subject: '驿丞', statement: '驿丞拆开密信', witnesses: '驿丞', para: '1' },
        { type: 'knowledge', fact: 'L2', holder: '驿丞', level: 'confirmed', para: '1' },
      ),
      opening(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('还没起 id');
  });

  it('开场的事实行用自己起的 id 引用', () => {
    const result = parseChanges(
      changeLines(
        {
          type: 'new_entity',
          kind: 'character',
          name: '驿丞',
          known_as: '',
          profile: '',
          para: '1',
          protagonist: 'true',
        },
        { type: 'new_entity', kind: 'item', name: '密信', known_as: '密信', profile: '', para: '1' },
        {
          type: 'event',
          subject: '驿丞',
          object: '密信',
          statement: '驿丞拆开密信',
          witnesses: '驿丞',
          para: '1',
          id: '读信',
        },
        { type: 'knowledge', fact: '读信', holder: '驿丞', level: 'confirmed', para: '1' },
      ),
      opening(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.knowledge[0]?.fact).toEqual({ line: 3 });
  });

  it('引用不存在的事实 id 时列出本次可用的 id', () => {
    const result = parseChanges(
      changeLines(
        {
          type: 'new_entity',
          kind: 'character',
          name: '驿丞',
          known_as: '',
          profile: '',
          para: '1',
          protagonist: 'true',
        },
        { type: 'event', subject: '驿丞', statement: '驿丞拆开密信', witnesses: '驿丞', para: '1', id: '读信' },
        { type: 'knowledge', fact: '读信2', holder: '驿丞', level: 'confirmed', para: '1' },
      ),
      opening(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('本次可用的事实 id：读信');
  });

  it('两行事实用了同一个 id 时被拒绝', () => {
    const result = parseChanges(
      changeLines(
        {
          type: 'new_entity',
          kind: 'character',
          name: '驿丞',
          known_as: '',
          profile: '',
          para: '1',
          protagonist: 'true',
        },
        { type: 'event', subject: '驿丞', statement: '驿丞拆开密信', witnesses: '驿丞', para: '1', id: '一' },
        { type: 'trait', subject: '驿丞', key: '警觉', statement: '他起了戒心', para: '1', id: '一' },
      ),
      opening(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.includes('changes.id'))).toBe(true);
  });

  it('开场引用找不到的名字时列出本次新增的人物和事物', () => {
    const result = parseChanges(
      changeLines(
        {
          type: 'new_entity',
          kind: 'character',
          name: '驿丞',
          known_as: '',
          profile: '',
          para: '1',
          protagonist: 'true',
        },
        { type: 'new_entity', kind: 'item', name: '密信', known_as: '那封信', profile: '', para: '1' },
        { type: 'event', subject: '天子', statement: '天子已死', witnesses: '驿丞', para: '1' },
      ),
      opening(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('找不到「天子」');
      expect(result.errors[0]).toContain('密信');
      expect(result.errors[0]).toContain('那封信');
    }
  });

  it('关系和约定缺少客体时被拒绝，不会被悄悄丢掉', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        changeLines(
          { type: 'relation', subject: '@1', key: 'trust', statement: '他信任她', para: '1' },
          { type: 'promise', subject: '@1', key: 'return', status: 'agreed', statement: '他答应回来', para: '1' },
        ),
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual(['第 1 行 changes.object：不能为空', '第 2 行 changes.object：不能为空']);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('认识阶段只能取三个值', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        '{"type":"relation","subject":"@1","object":"@2","key":"acquaintance","stage":"unknown","statement":"他们认识","para":"1"}',
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toContain('认识阶段只能是');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一组有键事实写了两行被拒绝', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        changeLines(
          { type: 'trait', subject: '@2', key: '心情', statement: '她很不安', para: '1' },
          { type: 'trait', subject: '@2', key: '心情', statement: '她平静下来', para: '2' },
        ),
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toContain('写的是同一项');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('多条错误一次全部返回', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        changeLines(
          { type: 'event', subject: '@99', statement: '有人来了', witnesses: '@1', para: '1' },
          { type: 'trait', subject: '@2', key: '', statement: '特征', para: '1' },
          {
            type: 'relation',
            subject: '@1',
            object: '@2',
            key: 'acquaintance',
            stage: 'unknown',
            statement: '关系',
            para: '1',
          },
        ),
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
