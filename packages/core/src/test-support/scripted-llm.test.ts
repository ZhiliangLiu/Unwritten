import { describe, expect, it } from 'vitest';
import { createScriptedLlm } from './scripted-llm.ts';
import { LlmRunError, type LlmTool } from '../llm/types.ts';

const tool: LlmTool = {
  name: 'propose_turn',
  description: '提交回合',
  parameters: {},
  async execute() {
    return { text: '已收到', terminate: true };
  },
};

function input() {
  return {
    purpose: 'narrator' as const,
    system: 'system',
    prompt: 'prompt',
    tools: [tool],
    requiredToolName: 'propose_turn',
    sessionId: '00000000-0000-4000-8000-000000000001',
    ref: { kind: 'turn_request' as const, id: 'request', attempt: 1, workId: null },
  };
}

describe('createScriptedLlm', () => {
  it('执行工具并返回', async () => {
    const llm = createScriptedLlm();
    llm.enqueue({ args: {} });
    await expect(llm.run(input())).resolves.toEqual({ requiredToolTerminated: true });
    expect(llm.runs).toHaveLength(1);
  });

  it('抛出脚本化的失败', async () => {
    const llm = createScriptedLlm();
    llm.enqueue({ fail: 'network', detail: '断了' });
    await expect(llm.run(input())).rejects.toMatchObject({ code: 'network', detail: '断了' } as LlmRunError);
  });

  it('没有步骤时按无效输出失败', async () => {
    const llm = createScriptedLlm();
    await expect(llm.run(input())).rejects.toMatchObject({ code: 'invalid_output' } as LlmRunError);
  });
});
