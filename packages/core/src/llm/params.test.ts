import { describe, expect, it } from 'vitest';
import { EMPTY_GENERATION_PARAMS, type GenerationParams, type ThinkingFormat } from '@unwritten/contracts';
import { paramsFromFile, paramsProblem, paramsToFile } from './params.ts';

function params(patch: Partial<GenerationParams>): GenerationParams {
  return { ...EMPTY_GENERATION_PARAMS, ...patch };
}

describe('llm params', () => {
  it('文件与视图互转', () => {
    expect(paramsToFile(params({}))).toBeUndefined();
    expect(paramsFromFile(undefined)).toEqual(EMPTY_GENERATION_PARAMS);
    expect(paramsToFile(params({ topK: 40 }))).toEqual({ topK: 40 });
  });

  it('思考参数的拒绝条件', () => {
    const cases: Array<{
      params: GenerationParams;
      model: { reasoning: boolean | null; thinkingFormat: ThinkingFormat };
      expected: 'thinking_unsupported' | null;
    }> = [
      {
        params: params({ thinking: 'high' }),
        model: { reasoning: false, thinkingFormat: 'openai' },
        expected: 'thinking_unsupported',
      },
      { params: params({ thinking: 'off' }), model: { reasoning: false, thinkingFormat: 'openai' }, expected: null },
      { params: params({ thinking: 'high' }), model: { reasoning: null, thinkingFormat: 'openai' }, expected: null },
      {
        params: params({ thinking: 'medium', thinkingBudget: 2048 }),
        model: { reasoning: true, thinkingFormat: 'qwen' },
        expected: null,
      },
      {
        params: params({ thinking: 'medium', thinkingBudget: 2048 }),
        model: { reasoning: true, thinkingFormat: 'openai' },
        expected: 'thinking_unsupported',
      },
      {
        params: params({ thinking: 'off', thinkingBudget: 2048 }),
        model: { reasoning: true, thinkingFormat: 'qwen' },
        expected: 'thinking_unsupported',
      },
      {
        params: params({ thinkingBudget: 2048 }),
        model: { reasoning: true, thinkingFormat: 'qwen' },
        expected: 'thinking_unsupported',
      },
    ];
    for (const item of cases) expect(paramsProblem(item.params, item.model)).toBe(item.expected);
  });
});
