import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
import { emptyProvidersFile } from '../providers/schema.ts';
import { createProvidersStore } from '../providers/file.ts';
import { createConnectionTester } from './test-connection.ts';
import { pingStep } from '../test-support/llm-steps.ts';
import { startFakeOpenAiServer } from '../test-support/fake-openai-server.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import type { LogEvent, Logger } from '../log/logger.ts';
import type { RuntimeTarget } from './pi.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

function setup(targetFor: () => RuntimeTarget | null = () => null) {
  const temp = makeTempDataDir();
  const file = join(temp.dir, 'providers.json');
  const store = createProvidersStore(file);
  const events: LogEvent[] = [];
  const tester = createConnectionTester({
    store,
    logger: {
      ...logger,
      record: (event) => {
        events.push(event);
      },
    },
    shutdown: new AbortController().signal,
    env: {},
    targetFor,
  });
  return { temp, file, store, tester, events };
}

describe('createConnectionTester', () => {
  it('调用 ping 即成功', async () => {
    const { temp, tester } = setup();
    const server = await startFakeOpenAiServer();
    try {
      server.enqueue(pingStep());
      const result = await tester({ baseUrl: server.baseUrl, modelId: 'm', key: { action: 'set', value: 'k' } });
      expect(result).toMatchObject({ ok: true, code: null, savedToolsCapability: false });
    } finally {
      await server.close();
      temp.cleanup();
    }
  });

  it('keep 时把 tools 能力写回文件', async () => {
    const { temp, file, store, tester } = setup();
    const server = await startFakeOpenAiServer();
    try {
      const baseUrl = server.baseUrl;
      store.write({
        ...emptyProvidersFile(),
        endpoints: [
          { id: 'ep', name: '测试', api: 'openai-completions', baseUrl, models: [{ id: 'm', tools: false }] },
        ],
      });
      server.enqueue(pingStep());
      const result = await tester({ baseUrl, modelId: 'm', key: { action: 'keep', endpointId: 'ep' } });
      expect(result.ok).toBe(true);
      expect(result.savedToolsCapability).toBe(true);
      expect(JSON.parse(readFileSync(file, 'utf8')).endpoints[0].models[0].tools).toBe(true);
    } finally {
      await server.close();
      temp.cleanup();
    }
  });

  it('错误 key、纯文本和重定向分别归类', async () => {
    const { temp, tester } = setup();
    const first = await startFakeOpenAiServer({ apiKey: 'right' });
    const second = await startFakeOpenAiServer();
    try {
      first.enqueue({ kind: 'text', text: '你好' });
      expect(
        (await tester({ baseUrl: first.baseUrl, modelId: 'm', key: { action: 'set', value: 'wrong' } })).code,
      ).toBe('unauthorized');

      first.reset();
      first.enqueue({ kind: 'text', text: '你好' });
      expect(
        (await tester({ baseUrl: first.baseUrl, modelId: 'm', key: { action: 'set', value: 'right' } })).code,
      ).toBe('no_tool_call');

      first.reset();
      first.enqueue({ kind: 'redirect', status: 302, location: `${second.baseUrl}/chat/completions` });
      const redirectResult = await tester({
        baseUrl: first.baseUrl,
        modelId: 'm',
        key: { action: 'set', value: 'right' },
      });
      expect(redirectResult.code).toBe('redirected');
      expect(second.requests).toHaveLength(0);
    } finally {
      await first.close();
      await second.close();
      temp.cleanup();
    }
  });

  it('连不上端口时报 unreachable，错误详情不含 key', async () => {
    const { temp, tester, events } = setup();
    try {
      expect((await tester({ baseUrl: 'http://127.0.0.1:1/v1', modelId: 'm', key: { action: 'none' } })).code).toBe(
        'unreachable',
      );
      const server = await startFakeOpenAiServer();
      try {
        server.enqueue({ kind: 'http_error', status: 401, message: 'bad secret-key' });
        const result = await tester({
          baseUrl: server.baseUrl,
          modelId: 'm',
          key: { action: 'set', value: 'secret-key' },
        });
        expect(result.code).toBe('unauthorized');
        expect(result.detail).not.toContain('secret-key');
        expect(result.diagnosticId).toMatch(/^[\da-f-]{36}$/);
        expect(events.at(-1)).toMatchObject({
          id: result.diagnosticId,
          event: 'llm.test',
          data: { ok: false, code: 'unauthorized', httpStatus: 401 },
        });
        expect(JSON.stringify(events)).not.toContain('secret-key');
      } finally {
        await server.close();
      }
    } finally {
      temp.cleanup();
    }
  });

  it('服务商回显的短 key 不会进入错误详情', async () => {
    const { temp, tester } = setup();
    const server = await startFakeOpenAiServer();
    try {
      server.enqueue({ kind: 'http_error', status: 401, message: 'Invalid key q7Z' });
      const result = await tester({
        baseUrl: server.baseUrl,
        modelId: 'm',
        key: { action: 'set', value: 'q7Z' },
      });
      expect(result.code).toBe('unauthorized');
      expect(result.detail).toContain('Invalid key [redacted]');
      expect(result.detail).not.toContain('q7Z');
    } finally {
      await server.close();
      temp.cleanup();
    }
  });

  it('按用途测试时带上用途的参数', async () => {
    const server = await startFakeOpenAiServer();
    const target: RuntimeTarget = {
      endpointId: 'ep',
      endpointName: '测试',
      baseUrl: server.baseUrl,
      modelId: 'm',
      apiKey: undefined,
      contextWindow: 32_768,
      maxOutputTokens: 1_024,
      thinkingFormat: 'openai',
      params: { ...EMPTY_GENERATION_PARAMS, thinking: 'high' },
    };
    const { temp, tester } = setup(() => target);
    try {
      server.enqueue(pingStep());
      const result = await tester({ purpose: 'narrator' });
      expect(result.ok).toBe(true);
      expect(server.requests.at(-1)?.body).toMatchObject({ reasoning_effort: 'high' });
    } finally {
      await server.close();
      temp.cleanup();
    }
  });
});
