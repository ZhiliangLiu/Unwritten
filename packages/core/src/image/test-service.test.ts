import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { createNetFetch } from '../net/fetch.ts';
import { createProvidersStore } from '../providers/file.ts';
import type { ImageService } from '../services.ts';
import { openDatabase } from '../store/db.ts';
import { startFakeImageServer } from '../test-support/fake-image-server.ts';
import { startFakeLauncher } from '../test-support/fake-launcher.ts';
import { startFakeOpenAiImages } from '../test-support/fake-openai-images.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createImageService } from './service.ts';

const REQUEST_ID = '00000000-0000-4000-8000-000000000031';

const silentLogger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

interface Harness {
  service: ImageService;
  serviceId: string;
  close(): void;
}

async function setup(options: {
  baseUrl: string;
  apiKey: string | null;
  protocol: 'unwritten-image' | 'openai-images';
  model?: string;
  openai?: { maxReferences: number; sizes: 'fixed' | 'custom' };
  launcher?: { baseUrl: string; apiKey: string | null };
}): Promise<Harness> {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const service = createImageService(
    {
      dataDir: temp.dir,
      db: opened.db,
      bus: createEventBus(),
      logger: silentLogger,
      shutdown: new AbortController().signal,
      providers: createProvidersStore(join(temp.dir, 'providers.json')),
      llm: createScriptedLlm(),
    },
    { env: {}, pollIntervalMs: 5, jobTimeoutMs: 5_000, wakePollMs: 10, wakeTimeoutMs: 5_000, fetch: createNetFetch() },
  );
  const created = await service.createService({
    requestId: REQUEST_ID,
    baseRevision: 'absent',
    name: '测试出图',
    protocol: options.protocol,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    model: options.model ?? null,
    openai: options.openai ?? null,
    launcher: options.launcher ?? null,
    idleMinutes: options.launcher === undefined ? null : 30,
  });
  return {
    service,
    serviceId: created.serviceId,
    close() {
      opened.close();
      temp.cleanup();
    },
  };
}

describe('image test service', () => {
  it('paid 为 false 的 OpenAI 测试只读 /models，不出图', async () => {
    const fake = await startFakeOpenAiImages();
    const harness = await setup({
      baseUrl: fake.baseUrl,
      apiKey: null,
      protocol: 'openai-images',
      model: 'gpt-image-2',
      openai: { maxReferences: 16, sizes: 'custom' },
    });
    try {
      const result = await harness.service.testService({
        serviceId: harness.serviceId,
        target: 'service',
        paid: false,
      });
      expect(result.ok).toBe(true);
      expect(result.code).toBeNull();
      expect(result.service).toMatchObject({ model: 'gpt-image-2', ready: true });
      expect(fake.requests.map((request) => request.path)).toEqual(['/v1/models']);
      expect(fake.requests.some((request) => request.path.endsWith('/images/generations'))).toBe(false);
    } finally {
      harness.close();
      await fake.close();
    }
  });

  it('paid 为 true 的 OpenAI 测试返回生成图的实际尺寸', async () => {
    const fake = await startFakeOpenAiImages();
    fake.enqueue({ kind: 'image', width: 1024, height: 1024 });
    const harness = await setup({
      baseUrl: fake.baseUrl,
      apiKey: null,
      protocol: 'openai-images',
      model: 'gpt-image-2',
      openai: { maxReferences: 16, sizes: 'custom' },
    });
    try {
      const result = await harness.service.testService({ serviceId: harness.serviceId, target: 'service', paid: true });
      expect(result).toMatchObject({ ok: true, generated: { width: 1024, height: 1024 } });
      expect(fake.requests.some((request) => request.path.endsWith('/images/generations'))).toBe(true);
    } finally {
      harness.close();
      await fake.close();
    }
  });

  it('unwritten-image 的测试连接返回能力和实现名', async () => {
    const server = await startFakeImageServer();
    const harness = await setup({
      baseUrl: server.url,
      apiKey: server.token,
      protocol: 'unwritten-image',
    });
    try {
      const result = await harness.service.testService({
        serviceId: harness.serviceId,
        target: 'service',
        paid: false,
      });
      expect(result.ok).toBe(true);
      expect(result.service).toMatchObject({
        implementation: { name: 'Fake', version: '0.0.0' },
        ready: true,
      });
      expect(result.service?.capabilities?.aspects).toContain('3:2');
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('测试启动器读取信息和状态', async () => {
    const server = await startFakeImageServer();
    const launcher = await startFakeLauncher();
    const harness = await setup({
      baseUrl: server.url,
      apiKey: server.token,
      protocol: 'unwritten-image',
      launcher: { baseUrl: launcher.url, apiKey: launcher.token },
    });
    try {
      const result = await harness.service.testService({
        serviceId: harness.serviceId,
        target: 'launcher',
        paid: false,
      });
      expect(result).toMatchObject({
        ok: true,
        launcher: {
          implementation: { name: 'Fake', version: '0.0.0' },
          ready: true,
          state: 'stopped',
        },
      });
    } finally {
      harness.close();
      await launcher.close();
      await server.close();
    }
  });

  it('没有配置启动器时测试启动器以 image_launcher_offline 结束', async () => {
    const server = await startFakeImageServer();
    const harness = await setup({ baseUrl: server.url, apiKey: server.token, protocol: 'unwritten-image' });
    try {
      const result = await harness.service.testService({
        serviceId: harness.serviceId,
        target: 'launcher',
        paid: false,
      });
      expect(result).toMatchObject({ ok: false, code: 'image_launcher_offline' });
    } finally {
      harness.close();
      await server.close();
    }
  });
});
