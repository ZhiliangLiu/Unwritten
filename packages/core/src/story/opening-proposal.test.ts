import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db.ts';
import { seedStory } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createCodeBook } from './codebook.ts';
import type { OpeningProposalContext } from './opening-proposal.ts';
import { parseOpeningProposal } from './opening-proposal.ts';
import { loadProjection } from './projection.ts';

const authorOpening =
  '船靠岸的时候，整座镇子黑着。\n\n{{protagonist.名字}}拎着邮袋走下跳板，只看见山顶的灯塔还亮着。\n\n一个提着马灯的人站在码头尽头，像是在等谁。';

const validArgs = {
  prose: authorOpening,
  options: '{"text":"向提灯的人问路","hint":"他会告诉你灯塔在哪里"}\n{"text":"先去邮局"}',
  place: '码头',
  time: '夜里',
  present: '',
  changes:
    '{"type":"new_entity","kind":"character","name":"沈岚","known_as":"撑伞的女人","profile":"带着黑伞","para":"2"}',
  state: '',
};

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = seedStory(opened.db, {
    turns: [{ prose: '船靠岸的时候，整座镇子黑着。' }],
    entities: [
      { key: 'protagonist', kind: 'character', name: '新来的邮差', profile: '二十多岁，记性好', protagonist: true },
      { key: 'keeper', kind: 'character', name: '林潮', profile: '守灯人，五十岁上下，话少' },
      { key: 'lighthouse', kind: 'place', name: '灯塔', profile: '山顶的灯塔，只在夜里亮着' },
    ],
    names: [
      { entity: 'protagonist', name: '新来的邮差', holder: 'protagonist', originTurn: null, para: 1 },
      { entity: 'keeper', name: '守灯人', holder: 'protagonist', originTurn: null, para: 3 },
      { entity: 'lighthouse', name: '灯塔', holder: 'protagonist', originTurn: null, para: 2 },
    ],
    stateDefs: [
      { key: '潮位', label: '潮位', display: 'number', config: { min: 0, max: 10, unit: '米' } },
      { key: '信任', label: '信任', display: 'stage', config: { stages: ['陌生', '相识', '信任', '决裂'] } },
      { key: '旧信', label: '旧信', display: 'list' },
      { key: '真名', label: '真名', display: 'text', hidden: true },
    ],
  });
  const projection = loadProjection(opened.db, { versionId: seeded.versionId, chain: [] });
  const codebook = createCodeBook(projection);
  const stateDefaults = new Map([
    [seeded.ids['state:潮位']!, { value: '3', visible: true }],
    [seeded.ids['state:信任']!, { value: '陌生', visible: true }],
    [seeded.ids['state:旧信']!, { value: '[]', visible: true }],
    [seeded.ids['state:真名']!, { value: null, visible: false }],
  ]);
  const ctx: OpeningProposalContext = {
    projection,
    codebook,
    hintMode: 'known_consequences',
    fixedProse: null,
    fieldNames: ['名字', '职业'],
    forbiddenNames: ['新来的邮差', '阿岚'],
    placeholderPolicy: 'reject',
    slots: [],
    stateDefaults,
  };
  return { temp, opened, ctx, ids: seeded.ids };
}

describe('parseOpeningProposal', () => {
  it('作者原文模式不读 prose 参数', () => {
    const { temp, opened, ctx } = setup();
    try {
      const fixedProse = '船靠岸的时候，整座镇子黑着。\n\n{{protagonist.名字}}拎着邮袋走下跳板。';
      const result = parseOpeningProposal(
        { ...validArgs, prose: '模型自己写的一段完全不同的开场。' },
        { ...ctx, fixedProse },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.prose).toBe(fixedProse);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('写死主角名：起草模式退回模型', () => {
    const { temp, opened, ctx } = setup();
    try {
      const hardcoded =
        '船靠岸的时候，整座镇子黑着。\n\n阿岚拎着邮袋走下跳板，只看见山顶的灯塔还亮着。\n\n一个提着马灯的人站在码头尽头，像是在等谁。';
      const rejected = parseOpeningProposal({ ...validArgs, prose: hardcoded }, ctx);
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) {
        expect(rejected.fields).toContain('placeholder');
        expect(rejected.errors.some((error) => error.includes('第 2 段'))).toBe(true);
        expect(rejected.errors.some((error) => error.includes('阿岚'))).toBe(true);
      }
      expect(parseOpeningProposal(validArgs, ctx).ok).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('写死主角名：作者原文模式列进待处理', () => {
    const { temp, opened, ctx } = setup();
    try {
      const fixedProse =
        '船靠岸的时候，整座镇子黑着。\n\n阿岚拎着邮袋走下跳板，只看见山顶的灯塔还亮着。\n\n一个提着马灯的人站在码头尽头，像是在等谁。';
      const result = parseOpeningProposal(
        { ...validArgs, prose: '' },
        { ...ctx, fixedProse, placeholderPolicy: 'review' },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview[0]).toEqual({
          where: 'prose',
          index: 2,
          reason: 'hardcoded_name',
          text: '阿岚拎着邮袋走下跳板，只看见山顶的灯塔还亮着。',
        });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('作者原文写死每局生成的人物也不写成作者设定', () => {
    const { temp, opened, ctx } = setup();
    try {
      const fixedProse =
        '船靠岸的时候，整座镇子黑着。\n\n顾青站在码头上，像是在等谁。\n\n一个提着马灯的人站在码头尽头。';
      const result = parseOpeningProposal(
        {
          ...validArgs,
          prose: '',
          changes:
            '{"type":"new_entity","kind":"character","name":"顾青","known_as":"顾青","profile":"在码头等人","para":"2","slot":"1"}',
        },
        {
          ...ctx,
          fixedProse,
          placeholderPolicy: 'review',
          slots: [{ index: '1', slotId: 'slot-a', name: null }],
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.needsReview).toContainEqual({
          where: 'prose',
          index: 2,
          reason: 'hardcoded_name',
          text: '顾青站在码头上，像是在等谁。',
        });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('未知占位符', () => {
    const { temp, opened, ctx } = setup();
    try {
      const result = parseOpeningProposal(
        {
          ...validArgs,
          prose: '船靠岸的时候，整座镇子黑着。\n\n{{protagonist.年龄}}站在码头上。\n\n一个提着马灯的人站在码头尽头。',
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields).toContain('placeholder');
        expect(result.errors.some((error) => error.includes('{{protagonist.年龄}}'))).toBe(true);
        expect(result.errors.some((error) => error.includes('名字、职业'))).toBe(true);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('正文和选项以外的地方不能写占位符', () => {
    const { temp, opened, ctx } = setup();
    try {
      const result = parseOpeningProposal(
        {
          ...validArgs,
          place: '{{protagonist.名字}}的船舱',
          changes:
            '{"type":"new_entity","kind":"character","name":"沈岚","known_as":"撑伞的女人","profile":"在等{{protagonist.名字}}","para":"2"}',
        },
        { ...ctx, fixedProse: authorOpening, placeholderPolicy: 'review' },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields).toContain('placeholder');
        expect(result.errors.some((error) => error.startsWith('参数 place'))).toBe(true);
        expect(result.errors.some((error) => error.includes('changes.profile'))).toBe(true);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场事实里写死主角名退回模型', () => {
    const { temp, opened, ctx } = setup();
    try {
      const result = parseOpeningProposal(
        {
          ...validArgs,
          changes:
            '{"type":"new_entity","kind":"character","name":"沈岚","known_as":"撑伞的女人","profile":"认识阿岚","para":"2"}',
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((error) => error.includes('「阿岚」'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('状态栏开局值里的未知占位符退回模型', () => {
    const { temp, opened, ctx } = setup();
    try {
      const result = parseOpeningProposal(
        { ...validArgs, state: '{"key":"旧信","item":"写给{{protagonist.年龄}}的信","status":"open"}' },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.some((error) => error.includes('{{protagonist.年龄}}'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('只显示行动的作品不接受提醒', () => {
    const { temp, opened, ctx } = setup();
    try {
      const result = parseOpeningProposal(validArgs, { ...ctx, hintMode: 'actions_only' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields).toContain('options');
        expect(result.errors.some((error) => error.includes('只显示行动'))).toBe(true);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('提醒里不能出现主角不知道的名字', () => {
    const { temp, opened, ctx } = setup();
    try {
      const result = parseOpeningProposal(
        { ...validArgs, options: '{"text":"问她的名字","hint":"沈岚在码头等你"}\n{"text":"先去邮局"}' },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields).toContain('leak');
        expect(result.errors.some((error) => error.includes('第 1 条提醒'))).toBe(true);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('每个人物位置正好一个人物', () => {
    const { temp, opened, ctx } = setup();
    try {
      const slots = [
        { index: '1', slotId: 'slot-a', name: null },
        { index: '2', slotId: 'slot-b', name: null },
      ];
      const missing = parseOpeningProposal(
        {
          ...validArgs,
          changes:
            '{"type":"new_entity","kind":"character","name":"顾青","profile":"在码头等人","para":"2","slot":"1"}',
        },
        { ...ctx, slots },
      );
      expect(missing.ok).toBe(false);
      if (!missing.ok) {
        expect(missing.fields).toContain('changes');
        expect(missing.errors.some((error) => error.includes('人物位置 2 没有对应的 new_entity'))).toBe(true);
      }

      const notPerRun = parseOpeningProposal(
        {
          ...validArgs,
          changes:
            '{"type":"new_entity","kind":"character","name":"顾青","profile":"在码头等人","para":"2","slot":"1"}',
        },
        ctx,
      );
      expect(notPerRun.ok).toBe(false);
      if (!notPerRun.ok) {
        expect(notPerRun.errors.some((error) => error.includes('主要人物是固定的'))).toBe(true);
      }

      const duplicate = parseOpeningProposal(
        {
          ...validArgs,
          changes:
            '{"type":"new_entity","kind":"character","name":"顾青","profile":"在码头等人","para":"2","slot":"1"}\n{"type":"new_entity","kind":"character","name":"周野","profile":"也在码头等人","para":"3","slot":"1"}',
        },
        { ...ctx, slots: [{ index: '1', slotId: 'slot-a', name: null }] },
      );
      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) {
        expect(duplicate.errors.some((error) => error.includes('已经在第 1 行登记过'))).toBe(true);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('初始状态按栏目校验，没写的用方案的初始值', () => {
    const { temp, opened, ctx, ids } = setup();
    try {
      const invalid = parseOpeningProposal(
        { ...validArgs, state: '{"key":"潮位","value":"12","visible":"true"}' },
        ctx,
      );
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) {
        expect(invalid.fields).toContain('state');
        expect(invalid.errors.some((error) => error.includes('范围'))).toBe(true);
      }

      const defaults = parseOpeningProposal(validArgs, ctx);
      expect(defaults.ok).toBe(true);
      if (defaults.ok) {
        const values = new Map(defaults.value.initialState.map((entry) => [entry.stateDefId, entry]));
        expect(values.get(ids['state:潮位']!)).toEqual({ stateDefId: ids['state:潮位'], value: '3', visible: true });
        expect(values.get(ids['state:信任']!)).toEqual({ stateDefId: ids['state:信任'], value: '陌生', visible: true });
        expect(values.get(ids['state:旧信']!)).toEqual({ stateDefId: ids['state:旧信'], value: '[]', visible: true });
        expect(values.has(ids['state:真名']!)).toBe(false);
      }

      const explicit = parseOpeningProposal(
        { ...validArgs, state: '{"key":"潮位","value":"5","visible":"false"}' },
        ctx,
      );
      expect(explicit.ok).toBe(true);
      if (explicit.ok) {
        expect(explicit.value.initialState.find((entry) => entry.stateDefId === ids['state:潮位'])).toEqual({
          stateDefId: ids['state:潮位'],
          value: '5',
          visible: false,
        });
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('幕后栏目不能设为显示', () => {
    const { temp, opened, ctx } = setup();
    try {
      const result = parseOpeningProposal(
        { ...validArgs, state: '{"key":"真名","value":"林潮","visible":"true"}' },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fields).toContain('state');
        expect(result.errors.some((error) => error.includes('幕后栏目 真名 不能设为显示'))).toBe(true);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
