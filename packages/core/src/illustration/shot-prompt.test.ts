import { describe, expect, it } from 'vitest';
import type { SceneMaterials } from '../story/scene-projection.ts';
import { buildCorrectionPrompt, buildShotPrompt, type ShotInput } from './shot-prompt.ts';

const materials: SceneMaterials = {
  skip: false,
  paragraphs: ['第一段。', '第二段。'],
  earlierText: '开场处境。',
  place: '旧码头',
  people: [
    {
      code: 'C1',
      entityId: 'entity-1',
      knownAs: '新来的邮差',
      appearance: '灰色雨衣',
      identityFactId: null,
      isProtagonist: true,
    },
    {
      code: 'C2',
      entityId: 'entity-2',
      knownAs: '守门人',
      appearance: '高个子，\n浅色雨衣',
      identityFactId: null,
      isProtagonist: false,
    },
  ],
  bannedNames: [],
  unknownNames: [],
};

function makeInput(overrides: Partial<ShotInput> = {}): ShotInput {
  return {
    materials,
    language: 'zh-CN',
    style: { kind: 'preset', preset: 'watercolor' },
    protagonistInFrame: false,
    aspects: ['3:2', '3:4'],
    fixedAspect: null,
    referenceViews: { C1: ['front', 'full_body'], C2: ['three_quarter'] },
    maxReferences: 3,
    negativePrompt: false,
    contentPolicy: '只画白天\n不画血',
    ...overrides,
  };
}

describe('buildShotPrompt', () => {
  it('按 C.2 的三块填正文、人物和镜头要求', () => {
    expect(buildShotPrompt(makeInput())).toBe(
      [
        '【已发生的正文】',
        '地点：旧码头',
        '此前正文或开场处境：开场处境。',
        '[段 1] 第一段。',
        '[段 2] 第二段。',
        '',
        '【在场的人】',
        'C1 | 称呼=新来的邮差 | 形象=灰色雨衣 | 主角=是 | 可用参考=front, full_body',
        'C2 | 称呼=守门人 | 形象=高个子， 浅色雨衣 | 主角=否 | 可用参考=three_quarter',
        '',
        '【镜头要求】',
        '作品语言：zh-CN',
        '画风：watercolor illustration, transparent washes, soft pigment edges, paper grain',
        '主角入画：否',
        '比例：自动选择（3:2, 3:4）',
        '最多参考图：3',
        '负面提示词：留空',
        '内容边界（只作约束）：只画白天 不画血',
        '输出标签：PROMPT, NEGATIVE, CAPTION, REFS, ASPECT',
      ].join('\n'),
    );
  });

  it('比例已确定时写固定比例，输出标签不带 ASPECT', () => {
    const prompt = buildShotPrompt(
      makeInput({
        fixedAspect: '3:4',
        aspects: ['3:2', '3:4'],
        style: { kind: 'custom', text: '水彩，暖色' },
        negativePrompt: true,
        contentPolicy: '',
      }),
    );
    expect(prompt).toContain('画风：水彩，暖色');
    expect(prompt).toContain('比例：3:4');
    expect(prompt).toContain('负面提示词：支持');
    expect(prompt).toContain('内容边界（只作约束）：无');
    expect(prompt.endsWith('输出标签：PROMPT, NEGATIVE, CAPTION, REFS')).toBe(true);
  });
});

describe('buildCorrectionPrompt', () => {
  it('原提示后附上一次的输出和逐条错误', () => {
    expect(buildCorrectionPrompt('原提示', '上一次输出', ['错误一', '错误二'])).toBe(
      [
        '原提示',
        '',
        '【你上一次的输出】',
        '上一次输出',
        '',
        '【请修正】',
        '- 错误一',
        '- 错误二',
        '按原格式重写完整结果。',
      ].join('\n'),
    );
  });
});
