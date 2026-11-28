import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_WORK_SETTINGS,
  PORTRAIT_UPLOAD_MAX_BODY_BYTES,
  contract,
  type ImageConfigView,
} from '@unwritten/contracts';
import { createLogger, type Logger } from '../log/logger.ts';
import { createEventBus } from '../events/bus.ts';
import type { Services } from '../services.ts';
import { appError } from '../errors.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createHttpApp } from './http-app.ts';
import { loadClientAssets } from './client-assets.ts';

const token = 'test-token';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

const emptyImageConfig: ImageConfigView = {
  status: 'missing',
  revision: 'absent',
  problem: null,
  services: [],
  selectedServiceId: null,
};

const notUsed = (): never => {
  throw new Error('not used');
};

function fakeServices(overrides: Partial<Services> = {}): Services {
  const bus = createEventBus();
  return {
    bus,
    logger,
    image: {
      listServices: () => emptyImageConfig,
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
      generatePreview: () => {
        throw new Error('not used');
      },
      adoptPreview: () => {
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
      get: () => DEFAULT_APPEARANCE,
      update: () => {
        throw new Error('not used');
      },
    },
    summary: {
      enqueue: () => {},
      backfill: () => 0,
      whenIdle: async () => {},
    },
    ...overrides,
  };
}

function assets() {
  const temp = makeTempDataDir();
  writeFileSync(join(temp.dir, 'index.html'), '<!doctype html><html lang="zh-CN"><head></head><body></body></html>');
  writeFileSync(join(temp.dir, 'boot.inline.js'), 'console.log(1)');
  mkdirSync(join(temp.dir, 'assets'));
  writeFileSync(join(temp.dir, 'assets', 'app.js'), 'console.log(2)');
  return temp;
}

function headers(extra: Record<string, string> = {}) {
  return { host: '127.0.0.1:4317', authorization: `Bearer ${token}`, ...extra };
}

describe('createHttpApp', () => {
  it('校验令牌、Host 和 Origin', async () => {
    const temp = assets();
    try {
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services: fakeServices(),
        logger,
      });
      expect(
        (
          await app.request('http://127.0.0.1:4317/api/works/list', {
            method: 'POST',
            body: '{}',
            headers: { host: '127.0.0.1:4317' },
          })
        ).status,
      ).toBe(401);
      expect(
        (await app.request('http://127.0.0.1:4317/api/works/list', { method: 'POST', body: '{}', headers: headers() }))
          .status,
      ).toBe(200);
      expect(
        (
          await app.request('http://127.0.0.1:4317/api/works/list', {
            method: 'POST',
            body: '{}',
            headers: headers({ host: 'evil.example:1' }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request('http://127.0.0.1:4317/api/works/list', {
            method: 'POST',
            body: '{}',
            headers: headers({ origin: 'http://evil.example' }),
          })
        ).status,
      ).toBe(403);
      const response = await app.request('http://127.0.0.1:4317/api/works/list', {
        method: 'POST',
        body: '{}',
        headers: headers({ origin: 'http://127.0.0.1:4317' }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      temp.cleanup();
    }
  });

  it('下发带 nonce 的 HTML 和内容安全策略', async () => {
    const temp = assets();
    try {
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services: fakeServices(),
        logger,
      });
      const first = await app.request('http://127.0.0.1:4317/', { headers: { host: '127.0.0.1:4317' } });
      const second = await app.request('http://127.0.0.1:4317/', { headers: { host: '127.0.0.1:4317' } });
      const firstHtml = await first.text();
      const secondHtml = await second.text();
      const firstNonce = /<script nonce="([^"]+)">/.exec(firstHtml)?.[1];
      const secondNonce = /<script nonce="([^"]+)">/.exec(secondHtml)?.[1];
      expect(firstHtml).toContain('data-uw-appearance="system"');
      expect(firstNonce).toBeTruthy();
      expect(secondNonce).not.toBe(firstNonce);
      expect(first.headers.get('content-security-policy')).toContain(`'nonce-${firstNonce}'`);
      expect(first.headers.get('content-security-policy')).toContain("img-src 'self' data: blob:");
      expect(first.headers.get('cache-control')).toBe('no-store');
    } finally {
      temp.cleanup();
    }
  });

  it('首页带上存下的外观偏好', async () => {
    const temp = assets();
    try {
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services: fakeServices({
          settings: {
            get: () => ({ ...DEFAULT_APPEARANCE, proseSize: '5' }),
            update: () => {
              throw new Error('not used');
            },
          },
        }),
        logger,
      });
      const response = await app.request('http://127.0.0.1:4317/', { headers: { host: '127.0.0.1:4317' } });
      expect(await response.text()).toContain('data-uw-prose-size="5"');
    } finally {
      temp.cleanup();
    }
  });

  it('只提供 assets 目录里的静态文件', async () => {
    const temp = assets();
    try {
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services: fakeServices(),
        logger,
      });
      const ok = await app.request('http://127.0.0.1:4317/assets/app.js', { headers: { host: '127.0.0.1:4317' } });
      expect(ok.status).toBe(200);
      expect(ok.headers.get('cache-control')).toContain('immutable');
      expect(
        (await app.request('http://127.0.0.1:4317/assets/missing.js', { headers: { host: '127.0.0.1:4317' } })).status,
      ).toBe(404);
    } finally {
      temp.cleanup();
    }
  });

  it('把业务错误原样返回', async () => {
    const temp = assets();
    try {
      const services = fakeServices({
        library: {
          ...fakeServices().library,
          list: () => {
            throw appError('stale_head', 'moved');
          },
        },
      });
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services,
        logger,
      });
      const response = await app.request('http://127.0.0.1:4317/api/works/list', {
        method: 'POST',
        body: '{}',
        headers: headers(),
      });
      expect(response.status).toBe(409);
    } finally {
      temp.cleanup();
    }
  });

  it('在运行中按 RPC 诊断编号查到过程和故障，省略异常与输入原文', async () => {
    const temp = makeTempDataDir();
    const runtimeLogger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    const db = new DatabaseSync(join(temp.dir, 'diagnostics.db'));
    try {
      const bodyMarker = '不存在的虚构背景';
      const errorMarker = 'private-error-marker';
      const workId = '00000000-0000-4000-8000-000000000001';
      const services = fakeServices({
        logger: runtimeLogger,
        library: {
          ...fakeServices().library,
          saveDraft: () => {
            const cause = Object.assign(new Error(errorMarker), { code: 'ERR_SQLITE_ERROR', errcode: 13 });
            throw new Error('Query failed', { cause });
          },
        },
      });
      const app = createHttpApp({ token, getPort: () => 4317, assets: null, services, logger: runtimeLogger });
      const request = (path: string, body: string) =>
        app.request(`http://127.0.0.1:4317/api/${path}`, {
          method: 'POST',
          body,
          headers: headers({ 'content-type': 'application/json' }),
        });
      const input = { workId, baseContentRev: 0, background: bodyMarker, settings: DEFAULT_WORK_SETTINGS };
      const failure = await request('works/saveDraft', JSON.stringify({ json: input }));
      expect(failure.status).toBe(507);
      const { json } = (await failure.json()) as { json: { code: string; data: { diagnosticId: string } } };
      expect(json.code).toBe('storage_full');
      expect(JSON.stringify(json)).not.toContain(errorMarker);

      const invalid = await request(
        'works/saveDraft',
        JSON.stringify({ json: { ...input, background: bodyMarker.repeat(20_000) } }),
      );
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({
        json: { code: 'background_too_long', data: { diagnosticId: expect.any(String) } },
      });
      const malformed = await request('works/saveDraft', '{');
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({
        json: { code: 'invalid_input', data: { diagnosticId: expect.any(String) } },
      });

      await new Promise<void>((resolve) => setImmediate(resolve));
      const entries = db.prepare('select id, work_id, data from diagnostic_events order by rowid').all();
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({
        id: json.data.diagnosticId,
        work_id: workId,
        data: expect.any(String),
      });
      expect(JSON.parse(String(entries[0]?.data))).toEqual({
        code: 'storage_full',
        stage: 'operation',
        procedure: 'works.saveDraft',
        errorType: 'sqlite',
        sqliteCode: 13,
      });
      expect(JSON.parse(String(entries[1]?.data))).toEqual({
        code: 'background_too_long',
        stage: 'input',
        procedure: 'works.saveDraft',
        issueCount: 1,
      });
      expect(JSON.parse(String(entries[2]?.data))).toEqual({ code: 'invalid_input', stage: 'transport' });
      expect(JSON.stringify(entries)).not.toContain(bodyMarker);
      expect(JSON.stringify(entries)).not.toContain(errorMarker);
    } finally {
      db.close();
      await runtimeLogger.close();
      temp.cleanup();
    }
  });

  it('旧过程照常返回，新过程返回真实视图', async () => {
    const temp = assets();
    try {
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services: fakeServices(),
        logger,
      });
      const request = (path: string) =>
        app.request(`http://127.0.0.1:4317/api/${path}`, {
          method: 'POST',
          body: '{}',
          headers: headers({ 'content-type': 'application/json' }),
        });
      const old = await request('works/list');
      expect(old.status).toBe(200);
      expect(await old.json()).toEqual({ json: [] });

      const fresh = await request('image/services/list');
      expect(fresh.status).toBe(200);
      expect(await fresh.json()).toEqual({ json: emptyImageConfig });
    } finally {
      temp.cleanup();
    }
  });

  it('人物参考上传超过体积上限时返回 413 且不调用服务', async () => {
    const temp = assets();
    try {
      let uploads = 0;
      const services = fakeServices({
        illustration: {
          ...fakeServices().illustration,
          portraitUpload: async () => {
            uploads += 1;
            throw appError('internal', 'test upload rejected');
          },
        },
      });
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services,
        logger,
      });
      const link = new RPCLink({
        url: 'http://127.0.0.1:4317/api',
        fetch: async (request) => {
          const forwarded = new Headers(request.headers);
          forwarded.set('host', '127.0.0.1:4317');
          forwarded.set('authorization', `Bearer ${token}`);
          return app.request(new Request(request, { headers: forwarded }));
        },
      });
      const client = createORPCClient(link) as ContractRouterClient<typeof contract>;
      const input = {
        requestId: '00000000-0000-4000-8000-000000000001',
        setId: '00000000-0000-4000-8000-000000000002',
        slot: 'front',
        expectedRev: 0,
      } as const;

      await expect(
        client.portrait.upload({ ...input, file: new File([new Uint8Array(16)], 'a.png', { type: 'image/png' }) }),
      ).rejects.toMatchObject({ code: 'internal' });
      expect(uploads).toBe(1);

      await expect(
        client.portrait.upload({
          ...input,
          requestId: '00000000-0000-4000-8000-000000000003',
          file: new File([new Uint8Array(PORTRAIT_UPLOAD_MAX_BODY_BYTES)], 'b.png', { type: 'image/png' }),
        }),
      ).rejects.toMatchObject({ status: 413 });
      expect(uploads).toBe(1);
    } finally {
      temp.cleanup();
    }
  });

  it('取图响应带 nosniff 和图片类型', async () => {
    const temp = assets();
    try {
      const services = fakeServices({
        illustration: {
          ...fakeServices().illustration,
          file: async () => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }),
        },
      });
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services,
        logger,
      });
      const served: { current: Response | null } = { current: null };
      const link = new RPCLink({
        url: 'http://127.0.0.1:4317/api',
        fetch: async (request) => {
          const forwarded = new Headers(request.headers);
          forwarded.set('host', '127.0.0.1:4317');
          forwarded.set('authorization', `Bearer ${token}`);
          served.current = await app.request(new Request(request, { headers: forwarded }));
          return served.current;
        },
      });
      const client = createORPCClient(link) as ContractRouterClient<typeof contract>;
      const file = await client.image.file({
        view: { kind: 'work', workId: '00000000-0000-4000-8000-000000000001' },
        image: { kind: 'portrait', setId: '00000000-0000-4000-8000-000000000002', slot: 'front' },
      });
      expect(served.current?.headers.get('x-content-type-options')).toBe('nosniff');
      expect(file.type).toBe('image/png');
      expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3]);
    } finally {
      temp.cleanup();
    }
  });

  it('设置过程已挂到路由上', async () => {
    const temp = assets();
    try {
      const services = fakeServices({
        settings: {
          get: () => DEFAULT_APPEARANCE,
          update: () => {
            throw new Error('not used');
          },
        },
      });
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services,
        logger,
      });
      const response = await app.request('http://127.0.0.1:4317/api/settings/get', {
        method: 'POST',
        body: '{}',
        headers: headers(),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ json: DEFAULT_APPEARANCE });
    } finally {
      temp.cleanup();
    }
  });
});
