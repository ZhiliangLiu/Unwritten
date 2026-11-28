import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import type { ImageServiceState } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { createNetFetch } from '../net/fetch.ts';
import { createProvidersStore } from '../providers/file.ts';
import type { ImageService } from '../services.ts';
import { openDatabase } from '../store/db.ts';
import { startFakeImageServer } from '../test-support/fake-image-server.ts';
import { startFakeLauncher } from '../test-support/fake-launcher.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { createImageService, type ImageRuntimeOptions } from './service.ts';

const REQUEST_ID = '00000000-0000-4000-8000-000000000021';

const silentLogger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

interface Harness {
  service: ImageService;
  serviceId: string;
  states: ImageServiceState[];
  close(): void;
}

async function setup(options: {
  baseUrl: string;
  apiKey: string;
  launcherUrl: string;
  launcherToken: string;
  fetch?: typeof fetch;
  runtime?: Omit<ImageRuntimeOptions, 'env'>;
}): Promise<Harness> {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const bus = createEventBus();
  const states: ImageServiceState[] = [];
  let ref: ImageService | null = null;
  const publish = bus.publish.bind(bus);
  bus.publish = (event) => {
    publish(event);
    if (event.type === 'image.service_state' && ref !== null) {
      states.push(ref.listServices().services[0]?.state ?? 'unknown');
    }
  };
  const service = createImageService(
    {
      dataDir: temp.dir,
      db: opened.db,
      bus,
      logger: silentLogger,
      shutdown: new AbortController().signal,
      providers: createProvidersStore(join(temp.dir, 'providers.json')),
      llm: createScriptedLlm(),
    },
    {
      env: {},
      pollIntervalMs: 5,
      jobTimeoutMs: 5_000,
      wakePollMs: 10,
      wakeTimeoutMs: 5_000,
      ...options.runtime,
      fetch: options.fetch ?? createNetFetch(),
    },
  );
  ref = service;
  const created = await service.createService({
    requestId: REQUEST_ID,
    baseRevision: 'absent',
    name: '测试出图',
    protocol: 'unwritten-image',
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: null,
    openai: null,
    launcher: { baseUrl: options.launcherUrl, apiKey: options.launcherToken },
    idleMinutes: 30,
  });
  return {
    service,
    serviceId: created.serviceId,
    states,
    close() {
      opened.close();
      temp.cleanup();
    },
  };
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition was not met in time');
    await delay(5);
  }
}

function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

function offlineFetch(imageUrl: string, state: { online: boolean }): typeof fetch {
  const base = createNetFetch();
  return (input, init) =>
    urlOf(input).startsWith(imageUrl) && !state.online
      ? Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
      : base(input, init);
}

describe('image waker', () => {
  it('按 waking → needs_action → waking → ready 转换，并自动探测到就绪', async () => {
    const server = await startFakeImageServer();
    const launcher = await startFakeLauncher();
    const online = { online: false };
    const harness = await setup({
      baseUrl: server.url,
      apiKey: server.token,
      launcherUrl: launcher.url,
      launcherToken: launcher.token,
      fetch: offlineFetch(server.url, online),
    });
    try {
      const prepared = harness.service.prepareGeneration(harness.serviceId, {
        manual: false,
        signal: new AbortController().signal,
      });
      await waitFor(() => harness.states.includes('needs_action'));
      online.online = true;
      await harness.service.continueWake({ serviceId: harness.serviceId, requestId: randomUUID() });
      const capabilities = await prepared;
      expect(capabilities.aspects).toContain('3:2');
      expect(harness.states).toEqual(['waking', 'needs_action', 'waking', 'ready']);
      expect(harness.service.listServices().services[0]?.state).toBe('ready');
    } finally {
      harness.close();
      await launcher.close();
      await server.close();
    }
  });

  it('启动器报告 failed 时保留原因', async () => {
    const server = await startFakeImageServer();
    const launcher = await startFakeLauncher();
    launcher.script([{ state: 'failed', afterMs: 10, reason: 'quota' }]);
    const harness = await setup({
      baseUrl: server.url,
      apiKey: server.token,
      launcherUrl: launcher.url,
      launcherToken: launcher.token,
      fetch: offlineFetch(server.url, { online: false }),
    });
    try {
      await expect(
        harness.service.prepareGeneration(harness.serviceId, { manual: false, signal: new AbortController().signal }),
      ).rejects.toMatchObject({ code: 'image_wake_failed' });
      expect(harness.service.listServices().services[0]).toMatchObject({
        state: 'wake_failed',
        wakeFailure: { code: 'image_wake_failed', reason: 'quota' },
      });
    } finally {
      harness.close();
      await launcher.close();
      await server.close();
    }
  });

  it('唤醒失败后成功的探测把状态恢复为 ready 且不重复发布', async () => {
    const server = await startFakeImageServer();
    const launcher = await startFakeLauncher();
    launcher.script([{ state: 'failed', afterMs: 10, reason: 'quota' }]);
    const online = { online: false };
    const harness = await setup({
      baseUrl: server.url,
      apiKey: server.token,
      launcherUrl: launcher.url,
      launcherToken: launcher.token,
      fetch: offlineFetch(server.url, online),
    });
    try {
      await expect(
        harness.service.prepareGeneration(harness.serviceId, { manual: false, signal: new AbortController().signal }),
      ).rejects.toMatchObject({ code: 'image_wake_failed' });
      expect(harness.service.listServices().services[0]).toMatchObject({
        state: 'wake_failed',
        wakeFailure: { code: 'image_wake_failed', reason: 'quota' },
      });

      online.online = true;
      await harness.service.prepareGeneration(harness.serviceId, {
        manual: true,
        signal: new AbortController().signal,
      });
      expect(harness.service.listServices().services[0]).toMatchObject({ state: 'ready', wakeFailure: null });
      const published = harness.states.length;
      expect(harness.states.at(-1)).toBe('ready');

      await harness.service.prepareGeneration(harness.serviceId, {
        manual: true,
        signal: new AbortController().signal,
      });
      expect(harness.states.length).toBe(published);
    } finally {
      harness.close();
      await launcher.close();
      await server.close();
    }
  });

  it('唤醒超时后向启动器发一次 stop', async () => {
    const server = await startFakeImageServer();
    const launcher = await startFakeLauncher();
    launcher.script([{ state: 'starting', afterMs: 0 }]);
    const harness = await setup({
      baseUrl: server.url,
      apiKey: server.token,
      launcherUrl: launcher.url,
      launcherToken: launcher.token,
      fetch: offlineFetch(server.url, { online: false }),
      runtime: { wakeTimeoutMs: 120 },
    });
    try {
      await expect(
        harness.service.prepareGeneration(harness.serviceId, { manual: false, signal: new AbortController().signal }),
      ).rejects.toMatchObject({ code: 'image_wake_timeout' });
      expect(
        launcher.requests.filter((request) => request.method === 'POST' && request.path === '/v1/stop'),
      ).toHaveLength(1);
      expect(harness.service.listServices().services[0]?.wakeFailure).toEqual({
        code: 'image_wake_timeout',
        reason: null,
      });
    } finally {
      harness.close();
      await launcher.close();
      await server.close();
    }
  });

  it('服务自检报告显存不足时立即失败', async () => {
    const server = await startFakeImageServer();
    const launcher = await startFakeLauncher();
    server.setReady(false, 'out_of_memory');
    launcher.script([{ state: 'running', afterMs: 10 }]);
    const online = { online: false };
    const harness = await setup({
      baseUrl: server.url,
      apiKey: server.token,
      launcherUrl: launcher.url,
      launcherToken: launcher.token,
      fetch: offlineFetch(server.url, online),
      runtime: { wakeTimeoutMs: 5_000 },
    });
    const timer = setTimeout(() => {
      online.online = true;
    }, 20);
    try {
      await expect(
        harness.service.prepareGeneration(harness.serviceId, { manual: false, signal: new AbortController().signal }),
      ).rejects.toMatchObject({ code: 'image_out_of_memory' });
      expect(harness.service.listServices().services[0]).toMatchObject({
        state: 'wake_failed',
        wakeFailure: { code: 'image_out_of_memory' },
      });
    } finally {
      clearTimeout(timer);
      harness.close();
      await launcher.close();
      await server.close();
    }
  });

  it('启动器连不上时抛 image_launcher_offline', async () => {
    const server = await startFakeImageServer();
    const launcher = await startFakeLauncher();
    const harness = await setup({
      baseUrl: server.url,
      apiKey: server.token,
      launcherUrl: launcher.url,
      launcherToken: launcher.token,
      fetch: offlineFetch(server.url, { online: false }),
    });
    await launcher.close();
    try {
      await expect(
        harness.service.prepareGeneration(harness.serviceId, { manual: false, signal: new AbortController().signal }),
      ).rejects.toMatchObject({ code: 'image_launcher_offline' });
      expect(harness.service.listServices().services[0]?.wakeFailure).toEqual({
        code: 'image_launcher_offline',
        reason: null,
      });
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('只中止一个调用者的等待，共用唤醒继续', async () => {
    const server = await startFakeImageServer();
    const launcher = await startFakeLauncher();
    const online = { online: false };
    const harness = await setup({
      baseUrl: server.url,
      apiKey: server.token,
      launcherUrl: launcher.url,
      launcherToken: launcher.token,
      fetch: offlineFetch(server.url, online),
    });
    try {
      const firstController = new AbortController();
      const first = harness.service.prepareGeneration(harness.serviceId, {
        manual: false,
        signal: firstController.signal,
      });
      const second = harness.service.prepareGeneration(harness.serviceId, {
        manual: false,
        signal: new AbortController().signal,
      });
      await waitFor(() => harness.states.includes('needs_action'));

      firstController.abort();
      await expect(first).rejects.toMatchObject({ name: 'AbortError' });

      let secondSettled = false;
      void second.then(
        () => {
          secondSettled = true;
        },
        () => {
          secondSettled = true;
        },
      );
      await delay(30);
      expect(secondSettled).toBe(false);

      online.online = true;
      await harness.service.continueWake({ serviceId: harness.serviceId, requestId: randomUUID() });
      const capabilities = await second;
      expect(capabilities.aspects).toContain('3:2');
    } finally {
      harness.close();
      await launcher.close();
      await server.close();
    }
  });
});
