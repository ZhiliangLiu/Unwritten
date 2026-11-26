import type { GenerationParams, ThinkingFormat, ThinkingLevel } from '@unwritten/contracts';
import { EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
import { describe, expect, it } from 'vitest';
import { fieldAvailability, formFromParams, paramsFromForm } from './params-form.ts';

interface Case {
  name: string;
  reasoning: boolean | null;
  thinkingFormat: ThinkingFormat;
  thinking: ThinkingLevel | 'unset';
  thinkingBudget: number | null;
  expected: 'thinking_unsupported' | null;
}

const CASES: Case[] = [
  {
    name: '能力为否 + high → 拒绝',
    reasoning: false,
    thinkingFormat: 'auto',
    thinking: 'high',
    thinkingBudget: null,
    expected: 'thinking_unsupported',
  },
  {
    name: '能力为否 + off → 通过',
    reasoning: false,
    thinkingFormat: 'auto',
    thinking: 'off',
    thinkingBudget: null,
    expected: null,
  },
  {
    name: '能力未知 + high → 通过',
    reasoning: null,
    thinkingFormat: 'auto',
    thinking: 'high',
    thinkingBudget: null,
    expected: null,
  },
  {
    name: 'qwen + medium + 预算 → 通过',
    reasoning: true,
    thinkingFormat: 'qwen',
    thinking: 'medium',
    thinkingBudget: 2048,
    expected: null,
  },
  {
    name: 'openai + medium + 预算 → 拒绝',
    reasoning: true,
    thinkingFormat: 'openai',
    thinking: 'medium',
    thinkingBudget: 2048,
    expected: 'thinking_unsupported',
  },
  {
    name: 'qwen + off + 预算 → 拒绝',
    reasoning: true,
    thinkingFormat: 'qwen',
    thinking: 'off',
    thinkingBudget: 2048,
    expected: 'thinking_unsupported',
  },
  {
    name: 'qwen + 未设档位 + 预算 → 拒绝',
    reasoning: true,
    thinkingFormat: 'qwen',
    thinking: 'unset',
    thinkingBudget: 2048,
    expected: 'thinking_unsupported',
  },
];

function formFor(item: Case) {
  return {
    ...EMPTY_GENERATION_PARAMS,
    thinking: item.thinking,
    thinkingBudget: item.thinkingBudget,
  };
}

describe('fieldAvailability', () => {
  for (const item of CASES) {
    it(item.name, () => {
      const availability = fieldAvailability(formFor(item), {
        reasoning: item.reasoning,
        thinkingFormat: item.thinkingFormat,
      });
      const thinkingInvalid = !availability.thinking.enabled && item.thinking !== 'unset' && item.thinking !== 'off';
      const budgetInvalid = !availability.thinkingBudget.enabled && item.thinkingBudget !== null;
      const clientResult = thinkingInvalid || budgetInvalid ? 'thinking_unsupported' : null;
      expect(clientResult).toBe(item.expected);
    });
  }
});

describe('params-form', () => {
  it('不设置转回 null', () => {
    const form = formFromParams({ ...EMPTY_GENERATION_PARAMS });
    expect(form.thinking).toBe('unset');
    expect(paramsFromForm({ ...form, thinking: 'unset' }).thinking).toBeNull();
  });

  it('参数在表单与请求之间原样往返', () => {
    const params: GenerationParams = {
      thinking: 'high',
      thinkingBudget: 2048,
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      minP: 0.05,
    };
    expect(paramsFromForm(formFromParams(params))).toEqual(params);
  });
});
