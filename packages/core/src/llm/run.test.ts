import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
import type { Logger } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase } from '../store/db.ts';
import { startFakeOpenAiServer } from '../test-support/fake-openai-server.ts';
import { rawToolStep, thinkingToolStep } from '../test-support/llm-steps.ts';
import { llmCallLogs } from '../store/schema.ts';
import { createCompleter, createRunner, opencodeHeaders } from './run.ts';
import type { RuntimeTarget } from './pi.ts';
import type { LlmTool } from './types.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

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
    ref: { kind: 'job' as const, id: 'job', attempt: 1, workId: null },
  };
}

function setup(
  baseUrl: string,
  timeouts = { firstOutputMs: 2_000, stallMs: 2_000 },
  overrides: Partial<RuntimeTarget> = {},
  logBodies = false,
) {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const targetFor = (): RuntimeTarget => ({
    endpointId: 'test',
    endpointName: 'Test',
    baseUrl,
    modelId: 'm',
    apiKey: undefined,
    contextWindow: 32_768,
    maxOutputTokens: 1_024,
    thinkingFormat: 'auto',
    params: EMPTY_GENERATION_PARAMS,
    ...overrides,
  });
  const runner = createRunner({
    db: opened.db,
    logger,
    shutdown: new AbortController().signal,
    timeouts,
    logBodies,
    targetFor,
  });
  const completer = createCompleter({
    db: opened.db,
    logger,
    shutdown: new AbortController().signal,
    timeouts,
    logBodies,
    targetFor,
  });
  return { temp, opened, runner, completer };
}

describe('createRunner', () => {
  it('工具调用一次成功，并写调用记录', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue(rawToolStep('propose_turn', { prose: '雨声' }));
      await expect(runner(input())).resolves.toEqual({ requiredToolTerminated: true });
      const rows = opened.db.all<{ status: string }>(sql`select status from llm_calls`);
      expect(rows).toEqual([{ status: 'ok' }]);
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]?.headers['user-agent']).toMatch(/^unwritten\//);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('开发构建记录 prompt、回复和 HTTP 交换', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl, undefined, {}, true);
    try {
      server.enqueue(rawToolStep('propose_turn', { prose: '雨声' }));
      await expect(runner(input())).resolves.toEqual({ requiredToolTerminated: true });
      const [log] = opened.db.select().from(llmCallLogs).all();
      expect(log?.system).toBe('system');
      expect(log?.prompt).toBe('prompt');
      expect(log?.response?.some((part) => part.type === 'toolCall' && part.name === 'propose_turn')).toBe(true);
      expect(log?.http).toHaveLength(1);
      expect(log?.http[0]?.requestBody).toContain('"model":"m"');
      expect(log?.http[0]?.responseBody).toContain('data:');
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('开发构建的调试日志抹掉响应里的 key', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl, undefined, { apiKey: 'secret-key' }, true);
    try {
      server.enqueue({ kind: 'http_error', status: 401, message: 'bad key secret-key' });
      await expect(runner(input())).rejects.toMatchObject({ code: 'unauthorized' });
      const [log] = opened.db.select().from(llmCallLogs).all();
      expect(log?.http[0]?.status).toBe(401);
      expect(log?.http[0]?.responseBody).toContain('[redacted]');
      expect(JSON.stringify(log)).not.toContain('secret-key');
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('先回文本、再调工具时补发提醒', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue({ kind: 'text', text: '我再想想' }, rawToolStep('propose_turn', { prose: '雨声' }));
      await runner(input());
      expect(server.requests).toHaveLength(2);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('连续三次文本按 invalid_output 失败', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue({ kind: 'text', text: '一' }, { kind: 'text', text: '二' }, { kind: 'text', text: '三' });
      await expect(runner(input())).rejects.toMatchObject({ code: 'invalid_output' });
      expect(server.requests).toHaveLength(3);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('第一次 500、第二次成功时重试一次', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue(
        { kind: 'http_error', status: 500, message: 'boom' },
        rawToolStep('propose_turn', { prose: '雨声' }),
      );
      await runner(input());
      expect(server.requests).toHaveLength(2);
      const rows = opened.db.all<{ status: string }>(sql`select status from llm_calls order by created_at`);
      expect(rows).toEqual([{ status: 'error' }, { status: 'ok' }]);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('401 只请求一次', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue({ kind: 'http_error', status: 401, message: 'no' });
      await expect(runner(input())).rejects.toMatchObject({ code: 'unauthorized' });
      expect(server.requests).toHaveLength(1);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('输出中途断开按 network 失败且不重试', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue({ kind: 'drop_mid_stream' });
      await expect(runner(input())).rejects.toMatchObject({ code: 'network' });
      expect(server.requests).toHaveLength(1);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('没有输出时按 timeout 失败', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl, { firstOutputMs: 100, stallMs: 100 });
    try {
      server.enqueue({ kind: 'hang' }, { kind: 'hang' });
      await expect(runner(input())).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('只给 opencode.ai 加会话头', () => {
    expect(opencodeHeaders('https://opencode.ai/inference/go/openai/v1', 'session')).toEqual({
      'x-opencode-client': 'unwritten',
      'x-opencode-session': 'session',
    });
    expect(opencodeHeaders('https://example.com/v1', 'session')).toEqual({});
  });

  it('openai 写法按档位发 reasoning_effort', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl, undefined, {
      thinkingFormat: 'openai',
      params: { ...EMPTY_GENERATION_PARAMS, thinking: 'high', temperature: 0.7, topK: 40 },
    });
    try {
      server.enqueue(rawToolStep('propose_turn', { prose: '雨声' }));
      await runner(input());
      const body = server.requests.at(-1)?.body as Record<string, unknown>;
      expect(body.reasoning_effort).toBe('high');
      expect(body.temperature).toBe(0.7);
      expect(body.top_k).toBe(40);
      expect(body).not.toHaveProperty('enable_thinking');
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('openai 写法的关闭发 none', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl, undefined, {
      thinkingFormat: 'openai',
      params: { ...EMPTY_GENERATION_PARAMS, thinking: 'off' },
    });
    try {
      server.enqueue(rawToolStep('propose_turn', { prose: '雨声' }));
      await runner(input());
      const body = (server.requests.at(-1)?.body ?? {}) as Record<string, unknown>;
      expect(body.reasoning_effort).toBe('none');
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('xhigh 不被压低', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl, undefined, {
      thinkingFormat: 'openai',
      params: { ...EMPTY_GENERATION_PARAMS, thinking: 'xhigh' },
    });
    try {
      server.enqueue(rawToolStep('propose_turn', { prose: '雨声' }));
      await runner(input());
      const body = (server.requests.at(-1)?.body ?? {}) as Record<string, unknown>;
      expect(body.reasoning_effort).toBe('xhigh');
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('qwen 写法发 enable_thinking 和预算', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl, undefined, {
      thinkingFormat: 'qwen',
      params: { ...EMPTY_GENERATION_PARAMS, thinking: 'medium', thinkingBudget: 2048 },
      maxOutputTokens: 8192,
    });
    try {
      server.enqueue(rawToolStep('propose_turn', { prose: '雨声' }));
      await runner(input());
      const body = server.requests.at(-1)?.body as Record<string, unknown>;
      expect(body.enable_thinking).toBe(true);
      expect(body.thinking_budget).toBe(2048);
      expect(body).not.toHaveProperty('reasoning_effort');
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('qwen 写法的关闭', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl, undefined, {
      thinkingFormat: 'qwen',
      params: { ...EMPTY_GENERATION_PARAMS, thinking: 'off' },
    });
    try {
      server.enqueue(rawToolStep('propose_turn', { prose: '雨声' }));
      await runner(input());
      const body = (server.requests.at(-1)?.body ?? {}) as Record<string, unknown>;
      expect(body.enable_thinking).toBe(false);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('qwen-chat-template 写法', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl, undefined, {
      thinkingFormat: 'qwen-chat-template',
      params: { ...EMPTY_GENERATION_PARAMS, thinking: 'low' },
    });
    try {
      server.enqueue(rawToolStep('propose_turn', { prose: '雨声' }));
      await runner(input());
      const body = server.requests.at(-1)?.body as { chat_template_kwargs?: { enable_thinking?: boolean } };
      expect(body.chat_template_kwargs?.enable_thinking).toBe(true);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('没设档位时不带任何思考字段', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl, undefined, {
      thinkingFormat: 'openai',
      params: { ...EMPTY_GENERATION_PARAMS, temperature: 0.5 },
    });
    try {
      server.enqueue(rawToolStep('propose_turn', { prose: '雨声' }));
      await runner(input());
      const body = server.requests.at(-1)?.body as Record<string, unknown>;
      expect(body).not.toHaveProperty('reasoning_effort');
      expect(body).not.toHaveProperty('enable_thinking');
      expect(body).not.toHaveProperty('chat_template_kwargs');
      expect(body).not.toHaveProperty('thinking');
      expect(body).not.toHaveProperty('reasoning');
      expect(body.temperature).toBe(0.5);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('思考输出也算模型有输出', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(
      server.baseUrl,
      { firstOutputMs: 300, stallMs: 900 },
      {
        thinkingFormat: 'openai',
        params: { ...EMPTY_GENERATION_PARAMS, thinking: 'high' },
      },
    );
    try {
      server.enqueue(thinkingToolStep('propose_turn', { prose: '雨声' }, '想'.repeat(200), 100));
      await expect(runner(input())).resolves.toEqual({ requiredToolTerminated: true });
      server.enqueue({ kind: 'hang' }, { kind: 'hang' });
      await expect(runner(input())).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('complete 返回文本并写调用记录', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, completer } = setup(server.baseUrl);
    try {
      server.enqueue({ kind: 'text', text: '灯塔亮到天明。' });
      const result = await completer({
        purpose: 'background',
        system: 'system',
        prompt: 'prompt',
        sessionId: 'route',
        ref: { kind: 'turn', id: 'turn', attempt: 1, workId: null },
        maxOutputTokens: 512,
      });
      expect(result.text).toBe('灯塔亮到天明。');
      const rows = opened.db.all<{ ref_kind: string }>(sql`select ref_kind from llm_calls`);
      expect(rows).toEqual([{ ref_kind: 'turn' }]);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('complete 持续输出时不受首字超时限制，停住时按 timeout 失败', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, completer } = setup(server.baseUrl, { firstOutputMs: 300, stallMs: 900 });
    const call = () =>
      completer({
        purpose: 'background',
        system: 'system',
        prompt: 'prompt',
        sessionId: 'route',
        ref: { kind: 'turn', id: 'turn', attempt: 1, workId: null },
        maxOutputTokens: 512,
      });
    try {
      server.enqueue({ kind: 'text', text: '潮'.repeat(400), chunkDelayMs: 100 });
      await expect(call()).resolves.toEqual({ text: '潮'.repeat(400) });
      server.enqueue({ kind: 'hang' }, { kind: 'hang' });
      await expect(call()).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('complete 收到空文本按无效输出处理', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, completer } = setup(server.baseUrl);
    try {
      server.enqueue({ kind: 'text', text: '' });
      await expect(
        completer({
          purpose: 'background',
          system: 'system',
          prompt: 'prompt',
          sessionId: 'route',
          ref: { kind: 'turn', id: 'turn', attempt: 1, workId: null },
          maxOutputTokens: 512,
        }),
      ).rejects.toMatchObject({ code: 'invalid_output' });
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });
});
