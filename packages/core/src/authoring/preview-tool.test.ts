import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCodeBook } from '../story/codebook.ts';
import { loadProjection } from '../story/projection.ts';
import type { OpeningProposalContext } from '../story/opening-proposal.ts';
import { openDatabase } from '../store/db.ts';
import { seedStory } from '../test-support/story-fixtures.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { parsePreviewArgs, previewToolParameters } from './preview-tool.ts';

const valid = {
  title: '雨夜修钟铺',
  blurb: '一个雨夜，你在钟铺里等一个人。',
  public_setting: '老城的钟铺，雨下了一整夜。',
  prose: '雨声盖住钟声。你抬头看向门口。\n\n门铃响了。',
  options: '{"text":"去开门"}\n{"text":"继续修钟"}',
  place: '钟铺',
  time: '深夜',
  language: 'zh-CN',
  present: '',
  changes:
    '{"type":"new_entity","kind":"character","name":"沈岚","known_as":"撑伞的女人","profile":"带着黑伞","para":"1"}',
  state: '',
};

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const seeded = seedStory(opened.db, {
    turns: [{ prose: '雨声盖住钟声。' }],
    entities: [
      { key: 'protagonist', kind: 'character', name: '守夜人', protagonist: true },
      { key: 'keeper', kind: 'character', name: '林潮', profile: '守灯人，话少' },
      { key: 'tower', kind: 'place', name: '灯塔', profile: '山顶的灯塔' },
    ],
    names: [
      { entity: 'keeper', name: '守灯人', holder: 'protagonist', originTurn: null, para: 1 },
      { entity: 'tower', name: '灯塔', holder: 'protagonist', originTurn: null, para: 1 },
    ],
    stateDefs: [{ key: '潮位', label: '潮位', display: 'number', config: { min: 0, max: 10, unit: '米' } }],
  });
  const projection = loadProjection(opened.db, { versionId: seeded.versionId, chain: [] });
  const codebook = createCodeBook(projection);
  const ctx: OpeningProposalContext = {
    projection,
    codebook,
    hintMode: 'known_consequences',
    fixedProse: null,
    fieldNames: ['名字'],
    forbiddenNames: [],
    placeholderPolicy: 'reject',
    slots: [],
    stateDefaults: new Map([[seeded.ids['state:潮位']!, { value: '3', visible: true }]]),
  };
  return { temp, opened, ctx, codebook, seeded };
}

describe('previewToolParameters', () => {
  it('作者原文模式没有 prose，每局生成写明人物位置', () => {
    const authorText = previewToolParameters('author_text', 'fixed');
    expect(authorText.required).not.toContain('prose');
    expect(authorText.properties).not.toHaveProperty('prose');
    expect(authorText.required).toContain('state');
    const perRun = previewToolParameters('ai', 'per_run');
    expect(JSON.stringify(perRun.properties)).toContain('每个人物位置用一行 new_entity');
    expect(JSON.stringify(previewToolParameters('ai', 'fixed').properties)).not.toContain('每个人物位置用一行');
  });
});

describe('parsePreviewArgs', () => {
  it('接受合格参数', () => {
    const { temp, opened, ctx } = setup();
    try {
      const result = parsePreviewArgs(valid, ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.preview.publicSetting).toBe(valid.public_setting);
        expect(result.value.preview.options).toHaveLength(2);
        expect(result.value.preview.scene).toEqual({ place: '钟铺', time: '深夜' });
        expect(result.value.preview.cast).toEqual([
          { kind: 'character', name: '沈岚', knownAs: '撑伞的女人', profile: '带着黑伞', protagonist: false },
        ]);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('每条规则都有错误说明', () => {
    const { temp, opened, ctx } = setup();
    try {
      expect(parsePreviewArgs({ ...valid, title: '' }, ctx).ok).toBe(false);
      expect(parsePreviewArgs({ ...valid, prose: '' }, ctx).ok).toBe(false);
      expect(parsePreviewArgs({ ...valid, options: '' }, ctx).ok).toBe(false);
      expect(
        parsePreviewArgs({ ...valid, options: '{"text":"一","hint":"x"}' }, { ...ctx, hintMode: 'actions_only' }).ok,
      ).toBe(false);
      expect(parsePreviewArgs({ ...valid, language: '不合法' }, ctx).ok).toBe(false);
      expect(parsePreviewArgs({ ...valid, title: 1 }, ctx).ok).toBe(false);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('预览列出本次新增的人物和地点', () => {
    const { temp, opened, ctx } = setup();
    try {
      const result = parsePreviewArgs(
        {
          ...valid,
          changes:
            '{"type":"new_entity","kind":"character","name":"沈岚","known_as":"撑伞的女人","profile":"带着黑伞","para":"1"}\n{"type":"new_entity","kind":"place","name":"钟铺","profile":"老城的钟铺","para":"1"}',
        },
        ctx,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.preview.cast.map((member) => member.name)).toEqual(['沈岚', '钟铺']);
        expect(result.value.preview.cast.every((member) => !member.protagonist)).toBe(true);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开场正文提前出现真名被拒绝', () => {
    const { temp, opened, ctx } = setup();
    try {
      const result = parsePreviewArgs({ ...valid, prose: '沈岚推门进来。' }, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((error) => error.includes('第 1 段'))).toBe(true);
        expect(result.fields).toEqual(['leak']);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('失败时报告出错的字段', () => {
    const { temp, opened, ctx } = setup();
    try {
      const emptyTitle = parsePreviewArgs({ ...valid, title: '' }, ctx);
      expect(emptyTitle.ok).toBe(false);
      if (!emptyTitle.ok) expect(emptyTitle.fields).toEqual(['title']);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('在场人物可以是作者设定的人物', () => {
    const { temp, opened, ctx, codebook, seeded } = setup();
    try {
      codebook.entityCode(seeded.ids.keeper!);
      const found = parsePreviewArgs({ ...valid, changes: '', present: '守灯人' }, ctx);
      expect(found.ok).toBe(true);

      const missing = parsePreviewArgs({ ...valid, present: '陌生人' }, ctx);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.errors.some((error) => error.includes('找不到「陌生人」'))).toBe(true);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('初始状态转成显示文字', () => {
    const { temp, opened, ctx } = setup();
    try {
      const result = parsePreviewArgs({ ...valid, state: '{"key":"潮位","value":"4","visible":"true"}' }, ctx);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.preview.initialState).toEqual([{ label: '潮位', text: '4 米', visible: true }]);
      }
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
