import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Logger } from './log/logger.ts';
import { createEventBus } from './events/bus.ts';
import type { ServiceFactories, Services } from './services.ts';
import { createLibraryService } from './library/service.ts';
import { makeTempDataDir } from './test-support/temp-dir.ts';
import { startCore } from './app.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

const notUsed = (): never => {
  throw new Error('not used');
};

function fakeServices(): Services {
  const bus = createEventBus();
  return {
    bus,
    logger,
    image: {
      listServices: () => ({
        status: 'missing',
        revision: 'absent',
        problem: null,
        services: [],
        selectedServiceId: null,
      }),
      createService: notUsed,
      updateService: notUsed,
      removeService: notUsed,
      generateToken: notUsed,
      testService: notUsed,
      select: notUsed,
      getOutputOptions: notUsed,
      setOutputPreferences: notUsed,
      getAutoIllustration: notUsed,
      setAutoIllustration: notUsed,
      activeTarget: () => null,
      prepareGeneration: notUsed,
      selectedServiceId: () => null,
      capabilities: () => null,
      assertFormat: notUsed,
      generate: notUsed,
      wake: notUsed,
      continueWake: notUsed,
      usageSummary: notUsed,
      pruneCalls: () => 0,
      whenIdle: async () => {},
    },
    illustration: {
      retry: notUsed,
      reroll: notUsed,
      dismiss: notUsed,
      portraitDraft: notUsed,
      portraitGet: notUsed,
      portraitUpload: notUsed,
      portraitGenerate: notUsed,
      portraitUpdate: notUsed,
      portraitAdopt: notUsed,
      portraitPreview: notUsed,
      file: notUsed,
      storageSummary: notUsed,
      prewarm: notUsed,
      suggestAppearance: notUsed,
      setWorkStyle: notUsed,
      enqueue: notUsed,
      forRoute: notUsed,
      journalPortraits: notUsed,
      recoverInterrupted: () => 0,
      prepareStorage: async () => {},
      collectGarbage: async () => {},
      kick() {},
      whenIdle: async () => {},
    },
    library: {
      list: () => [],
      create: () => {
        throw new Error('not used');
      },
      get: () => {
        throw new Error('not used');
      },
      novelChapters: () => {
        throw new Error('not used');
      },
      saveDraft: () => {
        throw new Error('not used');
      },
      setWizardStep: () => {
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
      listLogs: () => ({ items: [] }),
      getLog: () => {
        throw new Error('not used');
      },
      resolve: () => null,
      estimateTokens: () => 0,
      run: async () => ({ requiredToolTerminated: true }),
      complete: async () => {
        throw new Error('not used');
      },
      pruneCalls: () => 0,
    },
    authoring: {
      importNovel: () => {
        throw new Error('not used');
      },
      generatePreview: () => {
        throw new Error('not used');
      },
      adoptPreview: () => {
        throw new Error('not used');
      },
      applyDraft: () => {
        throw new Error('not used');
      },
      generatePlan: () => {
        throw new Error('not used');
      },
      adoptStalePlan: () => {
        throw new Error('not used');
      },
      updatePlanItem: () => {
        throw new Error('not used');
      },
      removePlanItem: () => {
        throw new Error('not used');
      },
      confirmPlan: () => {
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
      getStartInfo: () => {
        throw new Error('not used');
      },
      start: () => {
        throw new Error('not used');
      },
      getPlaythrough: () => {
        throw new Error('not used');
      },
      listPlaythroughs: () => {
        throw new Error('not used');
      },
      retryOpening: () => {
        throw new Error('not used');
      },
      getStatus: () => {
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
      image: () => services.image,
      illustration: () => services.illustration,
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

  it('启动清理失败仍可查询，删除清理失败有诊断，关闭等待清理结束', async () => {
    const temp = makeTempDataDir();
    const clientDir = join(temp.dir, 'client');
    mkdirSync(clientDir);
    writeFileSync(join(clientDir, 'index.html'), '<!doctype html><html lang="zh-CN"><head></head><body></body></html>');
    writeFileSync(join(clientDir, 'boot.inline.js'), '');
    const services = fakeServices();
    const startupError = Object.assign(new Error('虚构的启动清理错误不能进入诊断'), { code: 'ENOSPC' });
    const deletionError = Object.assign(new Error('虚构的删除清理错误不能进入诊断'), { code: 'EROFS' });
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let garbageCalls = 0;
    const illustration = {
      ...services.illustration,
      prepareStorage: async () => {
        throw startupError;
      },
      collectGarbage: async () => {
        garbageCalls += 1;
        if (garbageCalls === 1) return blocked;
        throw deletionError;
      },
    };
    const factories: ServiceFactories = {
      llm: () => services.llm,
      image: () => services.image,
      illustration: () => illustration,
      library: (deps) => createLibraryService(deps),
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
      logLevel: 'info',
    } as const;
    const core = await startCore(options, factories);
    try {
      const response = await fetch(`${core.origin}/api/works/list`, {
        method: 'POST',
        body: '{}',
        headers: { authorization: `Bearer ${core.token}`, 'content-type': 'application/json' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ json: [] });

      core.services.library.create({ workId: '00000000-0000-4000-8000-000000000101' });
      core.services.library.delete({ workId: '00000000-0000-4000-8000-000000000101' });
      core.services.library.create({ workId: '00000000-0000-4000-8000-000000000102' });
      core.services.library.delete({ workId: '00000000-0000-4000-8000-000000000102' });
      expect(garbageCalls).toBe(2);

      const closing = core.close();
      let settled = false;
      void closing.then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(settled).toBe(false);
      release();
      await closing;

      const diagnostics = new DatabaseSync(join(options.dataDir, 'diagnostics.db'));
      try {
        const rows = diagnostics
          .prepare("select data from diagnostic_events where event = 'image.gc.failed'")
          .all() as Array<{ data: string }>;
        const data = rows.map((row) => JSON.parse(row.data) as unknown);
        expect(data).toHaveLength(2);
        expect(data).toEqual(
          expect.arrayContaining([
            { trigger: 'startup', code: 'ENOSPC' },
            { trigger: 'work_deleted', code: 'EROFS' },
          ]),
        );
        const all = diagnostics.prepare('select data from diagnostic_events').all();
        expect(JSON.stringify(all)).not.toContain('不能进入诊断');
      } finally {
        diagnostics.close();
      }
    } finally {
      release();
      await core.close();
      temp.cleanup();
    }
  });
});
