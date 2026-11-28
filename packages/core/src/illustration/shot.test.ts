import { describe, expect, it } from 'vitest';
import type { PerformanceSample } from '../log/logger.ts';
import type { LlmRunRef } from '../llm/types.ts';
import type { SceneMaterials } from '../story/scene-projection.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { describeShot, type ShotDeps } from './shot.ts';
import type { ShotInput } from './shot-prompt.ts';

function makeMaterials(overrides: Partial<SceneMaterials> = {}): SceneMaterials {
  return {
    skip: false,
    paragraphs: ['第一段。', '第二段。'],
    earlierText: '此前正文。',
    place: '旧码头',
    people: [
      {
        code: 'C1',
        entityId: 'entity-1',
        knownAs: '短发的修表匠',
        appearance: '短发，浅色围裙',
        identityFactId: null,
        isProtagonist: true,
      },
      {
        code: 'C2',
        entityId: 'entity-2',
        knownAs: '守门人',
        appearance: '高个子，浅色雨衣',
        identityFactId: null,
        isProtagonist: false,
      },
    ],
    bannedNames: ['Lin Yuan', '沈岚'],
    unknownNames: ['沈岚'],
    ...overrides,
  };
}

function makeInput(overrides: Partial<ShotInput> = {}): ShotInput {
  return {
    materials: makeMaterials(),
    language: 'zh-CN',
    style: { kind: 'preset', preset: 'watercolor' },
    protagonistInFrame: false,
    aspects: ['3:2'],
    fixedAspect: '3:2',
    referenceViews: { C1: ['front', 'full_body'], C2: ['front', 'three_quarter'] },
    maxReferences: 4,
    negativePrompt: true,
    contentPolicy: '',
    ...overrides,
  };
}

function shotText(
  overrides: { prompt?: string; negative?: string; caption?: string; refs?: string; aspect?: string } = {},
): string {
  const lines = [
    `PROMPT: ${overrides.prompt ?? 'A short-haired figure holds out a brass key.'}`,
    `NEGATIVE: ${overrides.negative ?? ''}`,
    `CAPTION: ${overrides.caption ?? '修表匠把钥匙递到半空。'}`,
    `REFS: ${overrides.refs ?? ''}`,
  ];
  if (overrides.aspect !== undefined) lines.push(`ASPECT: ${overrides.aspect}`);
  return lines.join('\n');
}

const ref: LlmRunRef = { kind: 'illustration', id: 'illustration-1', attempt: 2, workId: 'work-1' };

function setup(samples: PerformanceSample[] = []): { deps: ShotDeps; llm: ReturnType<typeof createScriptedLlm> } {
  const llm = createScriptedLlm();
  const deps: ShotDeps = {
    llm,
    logger: {
      sample(sample) {
        samples.push(sample);
      },
    },
  };
  return { deps, llm };
}

describe('describeShot', () => {
  it('一次合格时返回映射好的参考和比例，修正次数为 0', async () => {
    const { deps, llm } = setup();
    const output = shotText({
      prompt: 'Medium two-shot. {{ref:1}} holds out a brass key while {{ref:2}} steps back.',
      negative: 'blurry edges',
      caption: '修表匠把钥匙递到半空，守门人退后半步。',
      refs: 'C1:full_body,C2:three_quarter',
    });
    llm.enqueue({ text: output });
    const result = await describeShot(deps, makeInput(), ref);
    expect(result).toEqual({
      prompt: 'Medium two-shot. {{ref:1}} holds out a brass key while {{ref:2}} steps back.',
      negative: 'blurry edges',
      caption: '修表匠把钥匙递到半空，守门人退后半步。',
      refs: [
        { code: 'C1', view: 'full_body' },
        { code: 'C2', view: 'three_quarter' },
      ],
      aspect: '3:2',
      corrections: 0,
    });
    expect(llm.completes).toHaveLength(1);
    const call = llm.completes[0]!;
    expect(call.purpose).toBe('background');
    expect(call.system).toContain('给故事画一个定格镜头');
    expect(call.system).toContain('画面说明用作品语言');
    expect(call.prompt).toContain('【已发生的正文】');
    expect(call.sessionId).toBe('illustration-illustration-1');
    expect(call.ref).toEqual(ref);
    expect(call.maxOutputTokens).toBe(800);
  });

  it('正面提示里有真名时返回修正，两次调用带同一个守卫和信号', async () => {
    const { deps, llm } = setup();
    const materials = makeMaterials({ bannedNames: ['Lin Yuan'] });
    llm.enqueue(
      { text: shotText({ prompt: 'A portrait of LIN YUAN holding a brass key.' }) },
      { text: shotText({ prompt: 'A short-haired figure holds out a brass key.' }) },
    );
    const guard = { endpointId: 'endpoint-a', modelId: 'model-a', assertCurrent() {} };
    const signal = new AbortController().signal;
    const result = await describeShot(deps, makeInput({ materials }), ref, { guard, signal });
    expect(result.corrections).toBe(1);
    expect(llm.completes).toHaveLength(2);
    expect(llm.completes[1]?.prompt).toContain('【你上一次的输出】');
    expect(llm.completes[1]?.prompt).toContain('A portrait of LIN YUAN holding a brass key.');
    expect(llm.completes[1]?.prompt).toContain('从英文提示词中删去人物真名，改用可见外貌或对应参考。');
    expect(llm.completes.every((input) => input.guard === guard)).toBe(true);
    expect(llm.completes.every((input) => input.signal === signal)).toBe(true);
  });

  it('画面说明里出现主角还不知道的称呼时返回修正', async () => {
    const { deps, llm } = setup();
    const materials = makeMaterials({ bannedNames: [], unknownNames: ['沈岚'] });
    llm.enqueue(
      { text: shotText({ caption: '守门人告诉修表匠，她就是沈岚。' }) },
      { text: shotText({ caption: '守门人把钥匙递到半空。' }) },
    );
    const result = await describeShot(deps, makeInput({ materials }), ref);
    expect(result.corrections).toBe(1);
    expect(llm.completes).toHaveLength(2);
    expect(llm.completes[1]?.prompt).toContain('CAPTION 只用这一段主角已经知道的称呼，去掉后来才揭晓的内容。');
  });

  it('画面说明超过 200 字时返回修正', async () => {
    const { deps, llm } = setup();
    llm.enqueue({ text: shotText({ caption: '灯'.repeat(201) }) }, { text: shotText() });
    const result = await describeShot(deps, makeInput(), ref);
    expect(result.corrections).toBe(1);
    expect(llm.completes).toHaveLength(2);
    expect(llm.completes[1]?.prompt).toContain('CAPTION 最多 200 字，只写一行。');
  });

  it('不支持负面提示词时忽略 NEGATIVE 的内容，负面为 null', async () => {
    const { deps, llm } = setup();
    const materials = makeMaterials({ bannedNames: ['Lin Yuan'] });
    llm.enqueue({ text: shotText({ negative: 'Lin Yuan' }) });
    const result = await describeShot(deps, makeInput({ materials, negativePrompt: false }), ref);
    expect(result.negative).toBeNull();
    expect(result.corrections).toBe(0);
    expect(llm.completes).toHaveLength(1);
  });

  it('自动比例时 ASPECT 不在候选里就返回修正', async () => {
    const { deps, llm } = setup();
    llm.enqueue({ text: shotText({ aspect: '16:9' }) }, { text: shotText({ aspect: '3:4' }) });
    const input = makeInput({ fixedAspect: null, aspects: ['3:2', '3:4'] });
    const result = await describeShot(deps, input, ref);
    expect(result.aspect).toBe('3:4');
    expect(result.corrections).toBe(1);
    expect(llm.completes).toHaveLength(2);
    expect(llm.completes[0]?.prompt).toContain('输出标签：PROMPT, NEGATIVE, CAPTION, REFS, ASPECT');
    expect(llm.completes[1]?.prompt).toContain('请在 ASPECT 填一个给定的比例。');
  });

  it('比例已确定时忽略模型多写的 ASPECT，不返回修正', async () => {
    const { deps, llm } = setup();
    llm.enqueue({ text: shotText({ aspect: '16:9' }) });
    const input = makeInput({ fixedAspect: '3:4', aspects: ['3:2', '3:4'] });
    const result = await describeShot(deps, input, ref);
    expect(result.aspect).toBe('3:4');
    expect(result.corrections).toBe(0);
    expect(llm.completes).toHaveLength(1);
    expect(llm.completes[0]?.prompt).toContain('输出标签：PROMPT, NEGATIVE, CAPTION, REFS');
    expect(llm.completes[0]?.prompt).not.toContain('REFS, ASPECT');
  });

  it.each([
    {
      name: '编号不在场',
      refs: 'C3:front',
      overrides: {},
      error: 'REFS 只填在场人物可用的编号和视角，按画面主次排列，每个人只出现一次。',
    },
    {
      name: '视角不可用',
      refs: 'C2:full_body',
      overrides: {},
      error: 'REFS 只填在场人物可用的编号和视角，按画面主次排列，每个人只出现一次。',
    },
    {
      name: '编号重复',
      refs: 'C1:front,C1:front',
      overrides: {},
      error: 'REFS 只填在场人物可用的编号和视角，按画面主次排列，每个人只出现一次。',
    },
    {
      name: '超过上限',
      refs: 'C1:front,C2:front',
      overrides: { maxReferences: 1 },
      error: 'REFS 超过本次可用的参考图数量，请减少。',
    },
  ])('REFS $name 时返回修正', async ({ refs, overrides, error }) => {
    const { deps, llm } = setup();
    llm.enqueue({ text: shotText({ refs }) }, { text: shotText() });
    const result = await describeShot(deps, makeInput(overrides), ref);
    expect(result.corrections).toBe(1);
    expect(llm.completes).toHaveLength(2);
    expect(llm.completes[1]?.prompt).toContain(error);
  });

  it('PROMPT 引用的序号超过 REFS 数量时返回修正', async () => {
    const { deps, llm } = setup();
    llm.enqueue(
      { text: shotText({ prompt: 'The figure {{ref:3}} holds out a brass key.', refs: 'C1:front,C2:front' }) },
      { text: shotText({ prompt: 'The short-haired figure holds out a brass key.', refs: 'C1:front' }) },
    );
    const result = await describeShot(deps, makeInput(), ref);
    expect(result.refs).toEqual([{ code: 'C1', view: 'front' }]);
    expect(llm.completes).toHaveLength(2);
    expect(llm.completes[1]?.prompt).toContain('PROMPT 里的参考序号必须从 1 起，且对应 REFS 里的某一项。');
  });

  it('三次都不合格时抛 invalid_output', async () => {
    const { deps, llm } = setup();
    llm.enqueue(
      { text: shotText({ caption: '' }) },
      { text: shotText({ caption: '' }) },
      { text: shotText({ caption: '' }) },
    );
    await expect(describeShot(deps, makeInput(), ref)).rejects.toMatchObject({ code: 'invalid_output' });
    expect(llm.completes).toHaveLength(3);
    expect(llm.completes[2]?.prompt).toContain('【请修正】');
  });

  it('称呼不是真名，留在 PROMPT 里不返回修正', async () => {
    const { deps, llm } = setup();
    const materials = makeMaterials({ bannedNames: ['Lin Yuan'] });
    llm.enqueue({ text: shotText({ prompt: 'The woman with the umbrella waits by the door.' }) });
    const result = await describeShot(deps, makeInput({ materials }), ref);
    expect(result.prompt).toContain('The woman with the umbrella waits by the door.');
    expect(result.corrections).toBe(0);
    expect(llm.completes).toHaveLength(1);
  });

  it('成功时记一条 illustration.shot 样本，data 只有次数和枚举', async () => {
    const samples: PerformanceSample[] = [];
    const { deps, llm } = setup(samples);
    llm.enqueue({ text: shotText({ refs: 'C1:front,C2:front' }) });
    await describeShot(deps, makeInput(), ref);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      metric: 'illustration.shot',
      outcome: 'ok',
      requestId: 'illustration-1',
      workId: 'work-1',
    });
    expect(samples[0]?.data).toEqual({ corrections: 0, refs: 2, autoAspect: false });
  });
});
