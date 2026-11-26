import { describe, expect, it } from 'vitest';
import {
  GenerationParamsSchema,
  SetPurposeInputSchema,
  THINKING_FORMATS,
  THINKING_LEVELS,
  TestConnectionInputSchema,
} from './llm.ts';

const emptyParams = {
  thinking: null,
  thinkingBudget: null,
  temperature: null,
  topP: null,
  topK: null,
  minP: null,
};

describe('llm schemas', () => {
  it('生成参数的边界', () => {
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, temperature: 0 }).success).toBe(true);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, temperature: 2 }).success).toBe(true);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, temperature: 2.01 }).success).toBe(false);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, temperature: -0.1 }).success).toBe(false);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, topP: 1 }).success).toBe(true);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, topP: 0 }).success).toBe(false);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, topK: 1 }).success).toBe(true);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, topK: 0 }).success).toBe(false);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, topK: 1.5 }).success).toBe(false);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, minP: 0 }).success).toBe(true);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, minP: 1 }).success).toBe(true);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, minP: 1.01 }).success).toBe(false);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, thinkingBudget: 1 }).success).toBe(true);
    expect(GenerationParamsSchema.safeParse({ ...emptyParams, thinkingBudget: 0 }).success).toBe(false);
  });

  it('设置用途兼容旧形状', () => {
    const parsed = SetPurposeInputSchema.parse({
      baseRevision: 'r',
      purpose: 'default',
      model: { endpointId: 'e', modelId: 'm' },
    });
    expect(parsed.params.thinking).toBeNull();
  });

  it('测试连接接受两种输入', () => {
    expect(
      TestConnectionInputSchema.safeParse({
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'm',
        key: { action: 'none' },
      }).success,
    ).toBe(true);
    expect(TestConnectionInputSchema.safeParse({ purpose: 'narrator' }).success).toBe(true);
    expect(TestConnectionInputSchema.safeParse({ purpose: 'author_chat' }).success).toBe(false);
  });

  it('思考档位与写法的取值', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(THINKING_FORMATS).toEqual(['auto', 'openai', 'qwen', 'qwen-chat-template', 'deepseek', 'openrouter', 'zai']);
  });
});
