import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
import type { Logger } from '../log/logger.ts';
import { createEventBus } from '../events/bus.ts';
import { startFakeOpenAiServer } from '../test-support/fake-openai-server.ts';
import { rawToolStep } from '../test-support/llm-steps.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase } from '../store/db.ts';
import { createLlmService } from './service.ts';

const requestId = '00000000-0000-4000-8000-000000000001';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

function setup(options: { dev?: boolean } = {}) {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const service = createLlmService(
    {
      dataDir: temp.dir,
      db: opened.db,
      bus: createEventBus(),
      logger,
      shutdown: new AbortController().signal,
      dev: options.dev,
    },
    { env: {} },
  );
  return { temp, opened, service, file: join(temp.dir, 'providers.json') };
}

describe('createLlmService', () => {
  it('新增端点、设默认并解析模型', async () => {
    const { temp, opened, service } = setup();
    try {
      const created = await service.createEndpoint({
        requestId: requestId as never,
        baseRevision: 'absent',
        name: '本机模型',
        baseUrl: 'http://127.0.0.1:11434/v1/',
        modelId: 'qwen',
        apiKey: null,
        makeDefault: true,
      });
      expect(created.config.endpoints[0]?.baseUrl).toBe('http://127.0.0.1:11434/v1');
      expect(created.config.purposes.find((view) => view.purpose === 'default')?.effectiveModel).toEqual({
        endpointId: created.endpointId,
        modelId: 'qwen',
      });
      expect(service.resolve('narrator')).toMatchObject({ endpointId: created.endpointId, modelId: 'qwen' });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('同一 requestId 重发复用 id，换名称则冲突', async () => {
    const { temp, opened, service } = setup();
    try {
      const input = {
        requestId: requestId as never,
        baseRevision: 'absent',
        name: '本机模型',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'qwen',
        apiKey: null,
        makeDefault: true,
      };
      const first = await service.createEndpoint(input);
      const second = await service.createEndpoint(input);
      expect(second.endpointId).toBe(first.endpointId);
      expect(second.config.endpoints).toHaveLength(1);
      await expect(service.createEndpoint({ ...input, name: '另一个' })).rejects.toMatchObject({
        code: 'idempotency_conflict',
      });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('过期 revision 拒绝写入，文件不变', async () => {
    const { temp, opened, service, file } = setup();
    try {
      await service.createEndpoint({
        requestId: requestId as never,
        baseRevision: 'absent',
        name: '本机模型',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'qwen',
        apiKey: null,
        makeDefault: true,
      });
      const before = readFileSync(file, 'utf8');
      await expect(
        service.createEndpoint({
          requestId: '00000000-0000-4000-8000-000000000002' as never,
          baseRevision: 'absent',
          name: '第二个',
          baseUrl: 'http://127.0.0.1:11434/v1',
          modelId: 'qwen',
          apiKey: null,
          makeDefault: false,
        }),
      ).rejects.toMatchObject({ code: 'config_conflict' });
      expect(readFileSync(file, 'utf8')).toBe(before);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('坏文件拒绝写入，视图显示出错状态', async () => {
    const temp = makeTempDataDir();
    const file = join(temp.dir, 'providers.json');
    writeFileSync(file, '{bad json');
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const service = createLlmService(
        {
          dataDir: temp.dir,
          db: opened.db,
          bus: createEventBus(),
          logger,
          shutdown: new AbortController().signal,
        },
        { env: {} },
      );
      expect(service.listProviders().status).toBe('invalid');
      await expect(
        service.createEndpoint({
          requestId: requestId as never,
          baseRevision: 'whatever',
          name: '本机模型',
          baseUrl: 'http://127.0.0.1:11434/v1',
          modelId: 'qwen',
          apiKey: null,
          makeDefault: true,
        }),
      ).rejects.toMatchObject({ code: 'llm_config_invalid' });
      expect(readFileSync(file, 'utf8')).toBe('{bad json');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('修改端点名称和 key 时视图不泄露 key', async () => {
    const { temp, opened, service } = setup();
    try {
      const created = await service.createEndpoint({
        requestId: requestId as never,
        baseRevision: 'absent',
        name: '本机模型',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'old-model',
        apiKey: 'sk-secret-value',
        makeDefault: true,
      });
      const updated = await service.updateEndpoint({
        baseRevision: created.config.revision,
        endpointId: created.endpointId,
        name: '改名',
        key: { action: 'keep' },
      });
      expect(JSON.stringify(updated)).not.toContain('sk-secret-value');
      expect(updated.endpoints[0]?.key).toEqual({ hasKey: true, source: 'file', envVar: null });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('清理 90 天以前的调用记录', () => {
    const { temp, opened, service } = setup();
    try {
      const old = Date.now() - 91 * 86_400_000;
      const now = Date.now();
      opened.db.run(
        sql`insert into llm_calls (id, purpose, provider, model, status, created_at)
            values ('old', 'narrator', 'p', 'm', 'ok', ${old})`,
      );
      opened.db.run(
        sql`insert into llm_calls (id, purpose, provider, model, status, created_at)
            values ('new', 'narrator', 'p', 'm', 'ok', ${now})`,
      );
      expect(service.pruneCalls()).toBe(1);
      expect(opened.db.all<{ id: string }>(sql`select id from llm_calls`)).toEqual([{ id: 'new' }]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开发构建列出并读取模型调用日志', () => {
    const { temp, opened, service } = setup({ dev: true });
    try {
      const createdAt = Date.now();
      const callId = '00000000-0000-4000-8000-000000000001';
      const response = JSON.stringify([{ type: 'text', text: '回复' }]);
      const http = JSON.stringify([
        {
          seq: 1,
          method: 'POST',
          url: 'http://127.0.0.1:1/v1/chat/completions',
          status: 200,
          requestBody: '{"model":"m"}',
          responseBody: 'data: {}',
          error: null,
        },
      ]);
      opened.db.run(
        sql`insert into llm_calls (id, purpose, provider, model, status, created_at)
            values (${callId}, 'narrator', 'p', 'm', 'ok', ${createdAt})`,
      );
      opened.db.run(
        sql`insert into llm_call_logs (call_id, system, prompt, response, http, created_at)
            values (${callId}, 'system', 'prompt', ${response}, ${http}, ${createdAt})`,
      );

      expect(service.logsStatus()).toEqual({ enabled: true });
      expect(service.listLogs({ limit: 10 })).toEqual({
        items: [
          {
            callId,
            purpose: 'narrator',
            workId: null,
            provider: 'p',
            model: 'm',
            refKind: null,
            refId: null,
            status: 'ok',
            error: null,
            inputTokens: null,
            outputTokens: null,
            durationMs: null,
            createdAt,
          },
        ],
      });
      expect(service.getLog({ callId })).toMatchObject({
        callId,
        system: 'system',
        prompt: 'prompt',
        response: [{ type: 'text', text: '回复' }],
        http: [{ seq: 1, status: 200 }],
      });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('开发构建记录真实调用的正文', async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, service } = setup({ dev: true });
    try {
      await service.createEndpoint({
        requestId: requestId as never,
        baseRevision: 'absent',
        name: '测试端点',
        baseUrl: server.baseUrl,
        modelId: 'm',
        apiKey: null,
        makeDefault: true,
      });
      server.enqueue(rawToolStep('propose_turn', { prose: '雨声' }));
      await service.run({
        purpose: 'narrator',
        system: 'system',
        prompt: 'prompt',
        tools: [
          {
            name: 'propose_turn',
            description: '提交',
            parameters: {},
            execute: async () => ({ text: 'ok', terminate: true }),
          },
        ],
        requiredToolName: 'propose_turn',
        sessionId: requestId,
        ref: { kind: 'job', id: 'job', attempt: 1, workId: null },
      });

      const [item] = service.listLogs({ limit: 10 }).items;
      expect(item?.purpose).toBe('narrator');
      const detail = service.getLog({ callId: item!.callId });
      expect(detail.system).toBe('system');
      expect(detail.prompt).toBe('prompt');
      expect(detail.http).toHaveLength(1);
      expect(detail.http[0]?.requestBody).toContain('"model":"m"');
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it('清理 7 天以前的调试日志', () => {
    const { temp, opened, service } = setup({ dev: true });
    try {
      const old = Date.now() - 8 * 86_400_000;
      const now = Date.now();
      opened.db.run(
        sql`insert into llm_calls (id, purpose, provider, model, status, created_at)
            values ('old-log', 'narrator', 'p', 'm', 'ok', ${now}),
                   ('new-log', 'narrator', 'p', 'm', 'ok', ${now})`,
      );
      opened.db.run(
        sql`insert into llm_call_logs (call_id, system, prompt, response, http, created_at)
            values ('old-log', 'system', 'prompt', null, '[]', ${old}),
                   ('new-log', 'system', 'prompt', null, '[]', ${now})`,
      );

      expect(service.pruneCalls()).toBe(0);
      expect(opened.db.all<{ call_id: string }>(sql`select call_id from llm_call_logs`)).toEqual([
        { call_id: 'new-log' },
      ]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('调试日志按时间往前翻页', () => {
    const { temp, opened, service } = setup({ dev: true });
    try {
      const now = Date.now();
      const older = now - 1;
      opened.db.run(
        sql`insert into llm_calls (id, purpose, provider, model, status, created_at)
            values ('00000000-0000-4000-8000-000000000011', 'narrator', 'p', 'm', 'ok', ${now}),
                   ('00000000-0000-4000-8000-000000000012', 'narrator', 'p', 'm', 'ok', ${older})`,
      );
      opened.db.run(
        sql`insert into llm_call_logs (call_id, system, prompt, response, http, created_at)
            values ('00000000-0000-4000-8000-000000000011', 'system', 'prompt', null, '[]', ${now}),
                   ('00000000-0000-4000-8000-000000000012', 'system', 'prompt', null, '[]', ${older})`,
      );

      expect(service.listLogs({ limit: 1 }).items.map((item) => item.callId)).toEqual([
        '00000000-0000-4000-8000-000000000011',
      ]);
      expect(service.listLogs({ limit: 10, before: now }).items.map((item) => item.callId)).toEqual([
        '00000000-0000-4000-8000-000000000012',
      ]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('删除作品时调试日志一并删除', () => {
    const { temp, opened } = setup({ dev: true });
    try {
      const now = Date.now();
      const workId = '00000000-0000-4000-8000-000000000002';
      opened.db.run(
        sql`insert into works (id, draft_id, created_at, updated_at)
            values (${workId}, 'draft', ${now}, ${now})`,
      );
      opened.db.run(
        sql`insert into llm_calls (id, purpose, work_id, provider, model, status, created_at)
            values ('call-work', 'narrator', ${workId}, 'p', 'm', 'ok', ${now})`,
      );
      opened.db.run(
        sql`insert into llm_call_logs (call_id, work_id, system, prompt, response, http, created_at)
            values ('call-work', ${workId}, 'system', 'prompt', null, '[]', ${now})`,
      );

      opened.db.run(sql`delete from works where id = ${workId}`);

      expect(opened.db.all(sql`select call_id from llm_call_logs`)).toEqual([]);
      expect(opened.db.all<{ work_id: string | null }>(sql`select work_id from llm_calls`)).toEqual([
        { work_id: null },
      ]);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('发布构建不返回调试日志', () => {
    const { temp, opened, service } = setup();
    try {
      expect(service.logsStatus()).toEqual({ enabled: false });
      expect(service.listLogs({ limit: 10 })).toEqual({ items: [] });
      expect(() => service.getLog({ callId: requestId as never })).toThrow();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('用途视图回落到默认', async () => {
    const { temp, opened, service } = setup();
    try {
      const created = await service.createEndpoint({
        requestId: requestId as never,
        baseRevision: 'absent',
        name: '本机模型',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'qwen',
        apiKey: null,
        makeDefault: true,
      });
      const views = created.config.purposes;
      const narrator = views.find((view) => view.purpose === 'narrator');
      const fallback = views.find((view) => view.purpose === 'default');
      expect(narrator).toMatchObject({
        inherited: true,
        effectiveModel: { endpointId: created.endpointId, modelId: 'qwen' },
        problem: null,
      });
      expect(fallback?.inherited).toBe(false);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('给不支持思考的模型设档位被拒绝', async () => {
    const { temp, opened, service, file } = setup();
    try {
      const created = await service.createEndpoint({
        requestId: requestId as never,
        baseRevision: 'absent',
        name: '本机模型',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'qwen',
        apiKey: null,
        makeDefault: true,
      });
      const updated = await service.updateModel({
        baseRevision: created.config.revision,
        endpointId: created.endpointId,
        modelId: 'qwen',
        reasoning: false,
        thinkingFormat: 'auto',
      });
      const before = readFileSync(file, 'utf8');
      await expect(
        service.setPurpose({
          baseRevision: updated.revision,
          purpose: 'narrator',
          model: { endpointId: created.endpointId, modelId: 'qwen' },
          params: { ...EMPTY_GENERATION_PARAMS, thinking: 'high' },
        }),
      ).rejects.toMatchObject({ code: 'thinking_unsupported' });
      expect(readFileSync(file, 'utf8')).toBe(before);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('删除最后一个模型被拒绝，删除其他模型清掉引用', async () => {
    const { temp, opened, service } = setup();
    try {
      const created = await service.createEndpoint({
        requestId: requestId as never,
        baseRevision: 'absent',
        name: '本机模型',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'first',
        apiKey: null,
        makeDefault: true,
      });
      const added = await service.addModel({
        baseRevision: created.config.revision,
        endpointId: created.endpointId,
        modelId: 'second',
      });
      const assigned = await service.setPurpose({
        baseRevision: added.revision,
        purpose: 'narrator',
        model: { endpointId: created.endpointId, modelId: 'second' },
        params: EMPTY_GENERATION_PARAMS,
      });
      const removed = await service.removeModel({
        baseRevision: assigned.revision,
        endpointId: created.endpointId,
        modelId: 'second',
      });
      expect(removed.purposes.find((view) => view.purpose === 'narrator')?.model).toBeNull();
      await expect(
        service.removeModel({
          baseRevision: removed.revision,
          endpointId: created.endpointId,
          modelId: 'first',
        }),
      ).rejects.toMatchObject({ code: 'last_model' });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('把模型改成不支持思考时清掉用途里的思考档位', async () => {
    const { temp, opened, service } = setup();
    try {
      const created = await service.createEndpoint({
        requestId: requestId as never,
        baseRevision: 'absent',
        name: '本机模型',
        baseUrl: 'http://127.0.0.1:11434/v1',
        modelId: 'qwen',
        apiKey: null,
        makeDefault: true,
      });
      const assigned = await service.setPurpose({
        baseRevision: created.config.revision,
        purpose: 'narrator',
        model: { endpointId: created.endpointId, modelId: 'qwen' },
        params: { ...EMPTY_GENERATION_PARAMS, thinking: 'high', temperature: 0.7 },
      });
      const updated = await service.updateModel({
        baseRevision: assigned.revision,
        endpointId: created.endpointId,
        modelId: 'qwen',
        reasoning: false,
        thinkingFormat: 'auto',
      });
      const narrator = updated.purposes.find((view) => view.purpose === 'narrator');
      expect(narrator?.params.thinking).toBeNull();
      expect(narrator?.params.temperature).toBe(0.7);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
