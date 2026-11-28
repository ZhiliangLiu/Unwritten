import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { seedLighthouseTown, seedNorthCape, type SeededStory } from '../test-support/story-fixtures.ts';
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

function turnContext(
  db: Database,
  versionId: string,
  headTurnId: string,
  options?: { parentPresentIds?: string[]; keyScenes?: Array<{ code: string; id: string; once: boolean }> },
): ChangesContext {
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
    parentPresentIds: options?.parentPresentIds ?? presentIdsAtHead(projection),
    keyScenes: options?.keyScenes ?? [],
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
      const result = parseChanges('{"type":"mood"}', turnContext(opened.db, seeded.versionId, seeded.headTurnId));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]).toContain('第 1 行 changes：不支持的类型 mood');
        expect(result.errors[0]).toContain('scene');
        expect(result.errors[0]).toContain('state');
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

  it('一行 JSON 数组里的多条变化各自成立', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        JSON.stringify([
          { type: 'new_entity', kind: 'character', name: '守夜人', profile: '', para: '1' },
          { type: 'new_entity', kind: 'character', name: '摆渡人', profile: '', para: '2' },
          { type: 'event', subject: '守夜人', statement: '守夜人点亮了灯', witnesses: '@1', para: '1' },
        ]),
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.entities.map((entity) => entity.name)).toEqual(['守夜人', '摆渡人']);
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
      const context = turnContext(opened.db, seeded.versionId, seeded.headTurnId, {
        parentPresentIds: [seeded.ids.shen ?? ''],
      });
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

  it('id 写在非事实行上时点明位置', () => {
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
        { type: 'new_entity', kind: 'item', name: '密信', known_as: '那封信', profile: '', para: '1', id: 'f1' },
        { type: 'knowledge', fact: 'f1', holder: '驿丞', level: 'confirmed', para: '1' },
      ),
      opening(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('第 2 行的 new_entity 上');
      expect(result.errors[0]).toContain('id 只能起在');
    }
  });

  it('id 写成数字时按字符串处理', () => {
    const result = parseChanges(
      [
        '{"type":"new_entity","kind":"character","name":"驿丞","known_as":"","profile":"","para":"1","protagonist":"true"}',
        '{"type":"event","subject":"驿丞","statement":"驿丞拆开密信","witnesses":"驿丞","para":"1","id":1}',
        '{"type":"knowledge","fact":"1","holder":"驿丞","level":"confirmed","para":"1"}',
      ].join('\n'),
      opening(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.knowledge[0]?.fact).toEqual({ line: 2 });
  });

  it('id 不能占用 core 发的编号前缀', () => {
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
        { type: 'event', subject: '驿丞', statement: '驿丞拆开密信', witnesses: '驿丞', para: '1', id: '#1' },
      ),
      opening(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('不能以 # 或 @ 开头');
  });

  it('没有事实行时，报错说明先写事实', () => {
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
        { type: 'knowledge', fact: 'f1', holder: '驿丞', level: 'confirmed', para: '1' },
      ),
      opening(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('没有事实行可引用');
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
        { type: 'new_entity', kind: 'item', name: '黑豆', known_as: '黑豆', profile: '', para: '1' },
        { type: 'event', subject: '天子', statement: '天子已死', witnesses: '驿丞', para: '1' },
      ),
      opening(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = result.errors.join('\n');
      expect(message).toContain('找不到「天子」');
      expect(message).toContain('密信');
      expect(message).toContain('那封信');
      expect(message.split('黑豆').length).toBe(2);
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

function lighthouseContext(
  db: Database,
  seeded: SeededStory,
  keyScenes: Array<{ code: string; id: string; once: boolean }> = [],
): ChangesContext {
  return turnContext(db, seeded.versionId, seeded.headTurnId, { keyScenes });
}

function lighthouseOpening(db: Database, seeded: SeededStory): ChangesContext {
  const chain = ancestorChain(db, seeded.headTurnId).map((turn) => ({
    id: turn.id,
    depth: turn.depth,
    action: turn.action,
    prose: turn.prose,
    scene: turn.scene,
  }));
  const projection = loadProjection(db, { versionId: seeded.versionId, chain });
  const codebook = createCodeBook(projection);
  for (const entity of projection.entities.values()) codebook.entityCode(entity.id);
  for (const fact of projection.facts) codebook.factCode(fact.id);
  return { mode: 'opening', projection, codebook, paragraphCount: 1, parentPresentIds: [], keyScenes: [] };
}

describe('parseChanges 新类型', () => {
  it('新增栏目通过校验后带回配置', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const result = parseChanges(
        '{"type":"new_state","key":"天气","label":"天气","display":"text","hidden":"false"}',
        lighthouseContext(opened.db, seeded),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.newStates).toHaveLength(1);
        expect(result.value.newStates[0]?.key).toBe('天气');
        expect(result.value.newStates[0]?.hidden).toBe(false);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('新增栏目和已有栏目重名被拒绝', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const result = parseChanges(
        '{"type":"new_state","key":"潮位","label":"潮位","display":"number"}',
        lighthouseContext(opened.db, seeded),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((error) => error.includes('栏目 潮位 已经存在。'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('每回合最多新增三个栏目', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const result = parseChanges(
        changeLines(
          { type: 'new_state', key: '甲', label: '甲', display: 'text' },
          { type: 'new_state', key: '乙', label: '乙', display: 'text' },
          { type: 'new_state', key: '丙', label: '丙', display: 'text' },
          { type: 'new_state', key: '丁', label: '丁', display: 'text' },
        ),
        lighthouseContext(opened.db, seeded),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContain('changes：每回合最多新增 3 个栏目。');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('写状态值时按栏目校验并规范化', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const result = parseChanges(
        '{"type":"state","key":"潮位","value":" 3.50 ","visible":"true","closed":"false"}',
        lighthouseContext(opened.db, seeded),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.states[0]).toMatchObject({ value: '3.5', visible: true, closed: false });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('状态值超出范围被拒绝', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const result = parseChanges('{"type":"state","key":"潮位","value":"12"}', lighthouseContext(opened.db, seeded));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((error) => error.includes('值超出了 min 到 max 的范围。'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('找不到栏目时列出可用的栏目', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const result = parseChanges('{"type":"state","key":"风向","value":"北"}', lighthouseContext(opened.db, seeded));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const message = result.errors.join('\n');
        expect(message).toContain('找不到栏目 风向');
        expect(message).toContain('潮位');
        expect(message).toContain('真名');
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('幕后栏目不能设为显示', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const result = parseChanges(
        '{"type":"state","key":"真名","value":"林潮","visible":"true"}',
        lighthouseContext(opened.db, seeded),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((error) => error.includes('幕后栏目 真名 不能设为显示。'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一个栏目每回合最多一行 state', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const result = parseChanges(
        changeLines({ type: 'state', key: '潮位', value: '4' }, { type: 'state', key: '潮位', value: '5' }),
        lighthouseContext(opened.db, seeded),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((error) => error.includes('每回合最多一行'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('清单条目写进清单一栏，其他栏目拒绝 state_item', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const accepted = parseChanges(
        '{"type":"state_item","key":"旧信","item":"第二封","status":"open"}',
        lighthouseContext(opened.db, seeded),
      );
      expect(accepted.ok).toBe(true);
      if (accepted.ok) expect(accepted.value.stateItems[0]).toMatchObject({ item: '第二封', status: 'open' });
      const rejected = parseChanges(
        '{"type":"state_item","key":"潮位","item":"第二封","status":"open"}',
        lighthouseContext(opened.db, seeded),
      );
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.errors.some((error) => error.includes('潮位 不是清单栏目'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('秘密的知情者必须是人', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const accepted = parseChanges(
        '{"type":"secret","title":"第三封信","statement":"第三封信藏在灯塔里","reveal":"主角找到第三封旧信时","knowers":"守灯人","para":"1"}',
        lighthouseContext(opened.db, seeded),
      );
      expect(accepted.ok).toBe(true);
      if (accepted.ok) expect(accepted.value.secrets[0]?.knowers).toEqual([{ existing: seeded.ids.linchao }]);
      const rejected = parseChanges(
        '{"type":"secret","title":"灯塔的来历","statement":"灯塔是后来修的","knowers":"灯塔","para":"1"}',
        lighthouseContext(opened.db, seeded),
      );
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.errors.some((error) => error.includes('灯塔 不是人物'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('只发生一次的场面不能再触发', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const scene = { code: 'S1', id: seeded.ids['scene:towerTop'] ?? '', once: true };
      const result = parseChanges(
        '{"type":"scene_hit","scene":"S1","para":"1"}',
        lighthouseContext(opened.db, seeded, [scene]),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((error) => error.includes('关键场面 S1 只发生一次，已经发生过。'))).toBe(true);
      }
      const repeatable = parseChanges(
        '{"type":"scene_hit","scene":"S1","para":"1"}',
        lighthouseContext(opened.db, seeded, [{ ...scene, once: false }]),
      );
      expect(repeatable.ok).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('找不到关键场面时列出未触发的场面', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const scene = { code: 'S1', id: seeded.ids['scene:towerTop'] ?? '', once: true };
      const result = parseChanges(
        '{"type":"scene_hit","scene":"S9","para":"1"}',
        lighthouseContext(opened.db, seeded, [scene]),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((error) => error.includes('找不到关键场面 S9'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('按方案生成的开场不能再新增主角', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const result = parseChanges(
        '{"type":"new_entity","kind":"character","name":"另起炉灶的主角","known_as":"","profile":"","para":"1","protagonist":"true"}',
        lighthouseOpening(opened.db, seeded),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((error) => error.includes('主角已经在作品设定里，不要再新增。'))).toBe(true);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场允许写人物位置，续写拒绝', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedLighthouseTown(opened.db);
      const line =
        '{"type":"new_entity","kind":"character","name":"临时的旅人","known_as":"","profile":"","para":"1","slot":"1"}';
      const opening = parseChanges(line, lighthouseOpening(opened.db, seeded));
      expect(opening.ok).toBe(true);
      if (opening.ok) expect(opening.value.entities[0]?.slot).toBe('1');
      const turn = parseChanges(line, lighthouseContext(opened.db, seeded));
      expect(turn.ok).toBe(false);
      if (!turn.ok) expect(turn.errors.some((error) => error.includes('续写时不能写人物位置。'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});

describe('parseChanges 形象', () => {
  const protagonistLine = {
    type: 'new_entity',
    kind: 'character',
    name: '驿丞',
    known_as: '',
    profile: '',
    para: '1',
    protagonist: 'true',
  };

  it('人物形象 300 字保留，301 字丢弃且不报错', () => {
    const kept = parseChanges(
      changeLines(protagonistLine, {
        type: 'new_entity',
        kind: 'character',
        name: '沈岚',
        known_as: '撑伞的女人',
        profile: '',
        appearance: '衣'.repeat(300),
        para: '1',
      }),
      opening(),
    );
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.value.entities[1]?.appearance).toBe('衣'.repeat(300));
      expect(kept.value.droppedAppearances).toBe(0);
    }

    const dropped = parseChanges(
      changeLines(protagonistLine, {
        type: 'new_entity',
        kind: 'character',
        name: '沈岚',
        known_as: '撑伞的女人',
        profile: '',
        appearance: '衣'.repeat(301),
        para: '1',
      }),
      opening(),
    );
    expect(dropped.ok).toBe(true);
    if (dropped.ok) {
      expect(dropped.value.entities[1]?.appearance).toBeNull();
      expect(dropped.value.droppedAppearances).toBe(1);
    }
  });

  it('形象带换行时丢弃，非人物不读形象', () => {
    const newline = parseChanges(
      changeLines(protagonistLine, {
        type: 'new_entity',
        kind: 'character',
        name: '沈岚',
        known_as: '',
        profile: '',
        appearance: '深色风衣\n短靴',
        para: '1',
      }),
      opening(),
    );
    expect(newline.ok).toBe(true);
    if (newline.ok) {
      expect(newline.value.entities[1]?.appearance).toBeNull();
      expect(newline.value.droppedAppearances).toBe(1);
    }

    const place = parseChanges(
      changeLines(protagonistLine, {
        type: 'new_entity',
        kind: 'place',
        name: '候船厅',
        known_as: '',
        profile: '',
        appearance: '木头长椅，玻璃窗',
        para: '1',
      }),
      opening(),
    );
    expect(place.ok).toBe(true);
    if (place.ok) {
      expect(place.value.entities[1]?.appearance).toBeNull();
      expect(place.value.droppedAppearances).toBe(0);
    }
  });

  it('形象特征不合格时整行丢弃，其他行照常', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        changeLines(
          { type: 'trait', subject: '@2', key: 'appearance', statement: '白围裙\n短卷发', para: '1' },
          { type: 'event', subject: '@2', statement: '她换了围裙', witnesses: '@1,@2', para: '1' },
        ),
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.facts.map((fact) => fact.kind)).toEqual(['event']);
        expect(result.value.droppedAppearances).toBe(1);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('same_visible_identity 写字符串 true 时存为 1', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        '{"type":"trait","subject":"@2","key":"appearance","statement":"换了白围裙，短卷发和左眉缺口仍可见","same_visible_identity":"true","para":"1"}',
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.facts[0]?.data).toEqual({ same_visible_identity: 1 });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('knowledge 引用本次的形象特征时返回附录 B.3 的修正文案', () => {
    const { temp, opened } = setup();
    try {
      const seeded = seedNorthCape(opened.db);
      const result = parseChanges(
        changeLines(
          {
            type: 'trait',
            subject: '@2',
            key: 'appearance',
            statement: '换了白围裙',
            para: '1',
            id: 'f1',
          },
          { type: 'knowledge', fact: 'f1', holder: '@1', level: 'confirmed', para: '1' },
        ),
        turnContext(opened.db, seeded.versionId, seeded.headTurnId),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toContain('形象特征只用于呈现，不能作为 knowledge 的引用。删去这条引用，再提交。');
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
