import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Logger } from './log/logger.ts';
import { createEventBus } from './events/bus.ts';
import type { ServiceFactories, Services } from './services.ts';
import { makeTempDataDir } from './test-support/temp-dir.ts';
import { startCore } from './app.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

function fakeServices(): Services {
  const bus = createEventBus();
  return {
    bus,
    logger,
    library: {
      list: () => [],
      create: () => {
        throw new Error('not used');
      },
      get: () => {
        throw new Error('not used');
      },
      saveBackground: () => {
        throw new Error('not used');
      },
      delete: () => {
        throw new Error('not used');
      },
    },
    llm: {
      listProviders: () => ({
        status: 'missing',
        revision: 'absent',
        problem: null,
        endpoints: [],
        purposes: [],
      }),
      createEndpoint: async () => {
        throw new Error('not used');
      },
      updateEndpoint: async () => {
        throw new Error('not used');
      },
      removeEndpoint: async () => {
        throw new Error('not used');
      },
      addModel: async () => {
        throw new Error('not used');
      },
      updateModel: async () => {
        throw new Error('not used');
      },
      removeModel: async () => {
        throw new Error('not used');
      },
      setPurpose: async () => {
        throw new Error('not used');
      },
      testConnection: async () => ({ ok: false, code: null, detail: null, savedToolsCapability: false }),
      resolve: () => null,
      estimateTokens: () => 0,
      run: async () => ({ requiredToolTerminated: true }),
      complete: async () => {
        throw new Error('not used');
      },
      pruneCalls: () => 0,
    },
    authoring: {
      generatePreview: () => {
        throw new Error('not used');
      },
      adoptPreview: () => {
        throw new Error('not used');
      },
      recoverInterrupted: () => 0,
      whenIdle: async () => {},
    },
    play: {
      getRoute: () => {
        throw new Error('not used');
      },
      submitAction: () => {
        throw new Error('not used');
      },
      retry: () => {
        throw new Error('not used');
      },
      getJournal: () => {
        throw new Error('not used');
      },
      recoverInterrupted: () => 0,
      pruneOldRequestLogs: () => 0,
      whenIdle: async () => {},
    },
    settings: {
      get: () => {
        throw new Error('not used');
      },
      update: () => {
        throw new Error('not used');
      },
    },
    summary: {
      enqueue: () => {},
      backfill: () => 0,
      whenIdle: async () => {},
    },
  };
}

describe('startCore', () => {
  it('启动、提供接口并在关闭后停止监听', async () => {
    const temp = makeTempDataDir();
    const clientDir = join(temp.dir, 'client');
    mkdirSync(clientDir);
    writeFileSync(join(clientDir, 'index.html'), '<!doctype html><html lang="zh-CN"><head></head><body></body></html>');
    writeFileSync(join(clientDir, 'boot.inline.js'), '');
    const services = fakeServices();
    const factories = {
      llm: () => services.llm,
      library: () => services.library,
      settings: () => services.settings,
      summary: () => services.summary,
      authoring: () => services.authoring,
      play: () => services.play,
    };
    const options = {
      dataDir: join(temp.dir, 'data'),
      port: 0,
      clientDir,
      clientOrigin: null,
      logLevel: 'error',
    } as const;
    const core = await startCore(options, factories);
    try {
      expect(core.url).toContain(`#token=${core.token}`);
      const response = await fetch(`${core.origin}/api/works/list`, {
        method: 'POST',
        body: '{}',
        headers: { authorization: `Bearer ${core.token}`, 'content-type': 'application/json' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ json: [] });

      const blockedDir = join(temp.dir, 'blocked');
      const shutdownOrder: string[] = [];
      const blockedFactories: ServiceFactories = {
        ...factories,
        summary: ({ db, shutdown }) => ({
          enqueue() {},
          backfill() {
            shutdownOrder.push('scheduled');
            shutdown.addEventListener('abort', () => shutdownOrder.push('aborted'), { once: true });
            return 1;
          },
          async whenIdle() {
            await Promise.resolve();
            expect(db.get(sql`select 1 as open`)).toEqual({ open: 1 });
            shutdownOrder.push('idle');
          },
        }),
      };
      await expect(
        startCore({ ...options, dataDir: blockedDir, port: core.port }, blockedFactories),
      ).rejects.toMatchObject({
        reason: 'port_in_use',
        diagnosticId: expect.any(String),
      });
      expect(shutdownOrder).toEqual(['scheduled', 'aborted', 'idle']);
      const db = new DatabaseSync(join(blockedDir, 'diagnostics.db'));
      try {
        const entry = db.prepare("select data from diagnostic_events where event = 'core.start_failed'").get();
        expect(JSON.parse(String(entry?.data))).toEqual({
          stage: 'http_listen',
          reason: 'port_in_use',
          errorType: 'system',
          systemCode: 'EADDRINUSE',
        });
      } finally {
        db.close();
      }
    } finally {
      await core.close();
      temp.cleanup();
    }
  });
});
