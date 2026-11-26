import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
import type { Logger } from '../log/logger.ts';
import { createEventBus } from '../events/bus.ts';
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

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
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
