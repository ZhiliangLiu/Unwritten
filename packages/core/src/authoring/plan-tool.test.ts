import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@unwritten/contracts';
import { changeLines } from '../test-support/llm-steps.ts';
import { parsePlanArgs, type PlanParseContext } from './plan-tool.ts';

const protagonist = {
  kind: 'character',
  role: 'protagonist',
  name: '新来的邮差',
  profile: '二十多岁，记性好',
  from: 'ai',
};
const place = { kind: 'place', role: 'other', name: '灯塔', profile: '镇子北面的灯塔', from: 'ai' };

const baseArgs = {
  language: 'zh-CN',
  summary: changeLines(
    { key: 'identity', text: '刚到灯塔镇的邮差，谁也不认识', from: 'ai' },
    { key: 'situation', text: '最后一班船靠岸时，镇上停了电', from: 'ai' },
  ),
  entities: changeLines(protagonist),
  secrets: '',
  state: '',
  scenes: '',
  ending: '',
  conflicts: '',
};

let idCounter = 0;
const newId = () => `id-${++idCounter}`;

function parse(
  overrides: Record<string, unknown> = {},
  context: Partial<PlanParseContext> = {},
): ReturnType<typeof parsePlanArgs> {
  idCounter = 0;
  return parsePlanArgs(
    { ...baseArgs, ...overrides },
    { castMode: 'fixed', protectedItems: [], authorTexts: [], newId, ...context },
  );
}

describe('parsePlanArgs', () => {
  it('恰好一个主角', () => {
    const none = parse({ entities: changeLines(place) });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors).toContain('entities：必须恰好有一行 "role":"protagonist"。');

    const two = parse({
      entities: changeLines(protagonist, { ...protagonist, name: '另一个邮差' }),
    });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.errors).toContain('entities：必须恰好有一行 "role":"protagonist"。');

    const one = parse();
    expect(one.ok).toBe(true);
    if (one.ok) {
      expect(one.value.items.filter((item) => item.kind === 'entity' && item.role === 'protagonist')).toHaveLength(1);
    }
  });

  it('人物行带形象时解析进方案项，非人物不带', () => {
    const result = parse({
      entities: changeLines(
        { ...protagonist, appearance: '短卷发，左眉有一道浅缺口，穿深色短外套' },
        { ...place, appearance: '不该出现在地点上' },
      ),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entities = result.value.items.filter((item) => item.kind === 'entity');
      expect(entities[0]).toMatchObject({ appearance: '短卷发，左眉有一道浅缺口，穿深色短外套' });
      expect(entities[1]).toMatchObject({ appearance: null });
    }
  });

  it('每局生成的人物位置必须写作用和相遇样例', () => {
    const context: Partial<PlanParseContext> = { castMode: 'per_run' };
    const missing = parse(
      {
        entities: changeLines(protagonist, { kind: 'character', role: 'cast', name: '旧友', from: 'ai' }),
      },
      context,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors).toContain(
        '第 2 行 entities：主要人物每次新开局生成，cast 行必须写 slot_role 和 encounter。',
      );
    }

    const filled = parse(
      {
        entities: changeLines(protagonist, {
          kind: 'character',
          role: 'cast',
          name: '旧友',
          slot_role: '在灯塔下等主角的人',
          encounter: '主角在码头问路时遇见',
          from: 'ai',
        }),
      },
      context,
    );
    expect(filled.ok).toBe(true);
    if (filled.ok) {
      const cast = filled.value.items.find((item) => item.kind === 'entity' && item.role === 'cast');
      expect(cast?.kind === 'entity' && cast.slot).toEqual({
        role: '在灯塔下等主角的人',
        encounter: '主角在码头问路时遇见',
      });
    }
  });

  it('固定人物的作品不写人物位置', () => {
    const result = parse({
      entities: changeLines(protagonist, {
        kind: 'character',
        role: 'cast',
        name: '旧友',
        slot_role: '在灯塔下等主角的人',
        encounter: '主角在码头问路时遇见',
        from: 'ai',
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('第 2 行 entities：固定主要角色的作品不写 slot_role 和 encounter。');
    }
  });

  it('秘密的知情者必须是人物', () => {
    const result = parse({
      entities: changeLines(protagonist, place),
      secrets: changeLines({
        title: '灯塔的旧事',
        statement: '灯塔里留着上一任看守的信',
        knowers: '灯塔',
        from: 'ai',
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('第 1 行 secrets.knowers：灯塔 不是人物。');
  });

  it('栏目配置按显示方式校验', () => {
    const badRange = parse({
      state: changeLines({ key: '潮位', label: '潮位', display: 'number', min: '10', max: '0', from: 'ai' }),
    });
    expect(badRange.ok).toBe(false);
    if (!badRange.ok) expect(badRange.errors).toContain('第 1 行 state：数字栏目的 min 必须小于 max。');

    const badStages = parse({
      state: changeLines({ key: '信任', label: '信任', display: 'stage', stages: '起点', from: 'ai' }),
    });
    expect(badStages.ok).toBe(false);
    if (!badStages.ok) {
      expect(badStages.errors).toContain('第 1 行 state：阶段栏目至少要有两个不同的阶段名。');
    }
  });

  it('受保护的项优先', () => {
    const protectedItems: PlanItem[] = [
      {
        kind: 'entity',
        id: 'protected-keeper',
        entityKind: 'character',
        role: 'cast',
        name: '灯塔看守',
        knownAs: null,
        profile: '话少',
        appearance: null,
        slot: null,
        source: 'author',
      },
    ];
    const result = parse(
      {
        entities: changeLines(protagonist, {
          kind: 'character',
          role: 'cast',
          name: '灯塔看守',
          profile: '模型编的档案',
          from: 'ai',
        }),
      },
      { protectedItems },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const keepers = result.value.items.filter((item) => item.kind === 'entity' && item.name === '灯塔看守');
      expect(keepers).toHaveLength(1);
      expect(keepers[0]).toMatchObject({ id: 'protected-keeper', source: 'author', profile: '话少' });
    }
  });

  it('冲突原话逐字核对', () => {
    const result = parse(
      {
        conflicts: changeLines(
          {
            first: '她从不离开岛。  她每年冬天去城里',
            second: '她每年冬天去城里',
            impact: '读者会分不清她到底离不离岛',
          },
          { first: '她从不离开岛', second: '她讨厌海', impact: '前后说法不一致' },
        ),
      },
      { authorTexts: ['她从不离开岛。 她每年冬天去城里。'] },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.conflicts).toHaveLength(1);
      expect(result.value.conflicts[0]?.first).toBe('她从不离开岛。  她每年冬天去城里');
      expect(result.value.droppedConflicts).toBe(1);
    }
  });

  it('重复的 summary key 报错', () => {
    const result = parse({
      summary: changeLines(
        { key: 'identity', text: '刚到灯塔镇的邮差', from: 'ai' },
        { key: 'identity', text: '另一个身份', from: 'ai' },
        { key: 'situation', text: '最后一班船靠岸时，镇上停了电', from: 'ai' },
      ),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('第 2 行 summary：key identity 已经写过。');
  });
});
