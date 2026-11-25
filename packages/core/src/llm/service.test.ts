import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
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
      expect(created.config.defaultModel).toEqual({ endpointId: created.endpointId, modelId: 'qwen' });
      expect(service.resolve('narrator')).toMatchObject({ endpointId: created.endpointId, modelId: 'qwen' });
      expect(created.config.defaultModelUsable).toBe(true);
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

  it('修改模型 id 时把默认用途一起改掉，视图不泄露 key', async () => {
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
        modelId: 'new-model',
        key: { action: 'keep' },
      });
      expect(updated.defaultModel).toEqual({ endpointId: created.endpointId, modelId: 'new-model' });
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
});
