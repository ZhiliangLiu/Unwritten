import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import type { CreateImageServiceInput, OpenAiImageOptions } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { createNetFetch } from '../net/fetch.ts';
import { createProvidersStore } from '../providers/file.ts';
import { emptyProvidersFile } from '../providers/schema.ts';
import { openDatabase, type Database } from '../store/db.ts';
import { imageCalls } from '../store/schema.ts';
import { startFakeImageServer } from '../test-support/fake-image-server.ts';
import { startFakeLauncher } from '../test-support/fake-launcher.ts';
import { startFakeOpenAiImages } from '../test-support/fake-openai-images.ts';
import { pngBytes } from '../test-support/image-bytes.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createImageEngine } from './engine.ts';
import type { ImageGenerateInput } from './engine-types.ts';
import { ImageError } from './errors.ts';
import type { ProbeOutcome, Prober } from './probe.ts';
import { createImageQueue } from './queue.ts';
import { createImageService, type ImageRuntimeOptions } from './service.ts';
import { createWaker } from './wake.ts';
import type { ImageService } from '../services.ts';

type Recorded = { level: string; event: string; data?: Record<string, unknown> };

function recordingLogger(events: Recorded[]): Logger {
  return {
    record(entry) {
      events.push({ level: entry.level, event: entry.event, data: entry.data });
    },
    sample() {},
    async flush() {},
    async close() {},
  };
}

interface HarnessOptions {
  baseUrl: string;
  apiKey?: string | null;
  protocol?: 'unwritten-image' | 'openai-images';
  model?: string | null;
  openai?: OpenAiImageOptions | null;
  launcherUrl?: string;
  launcherToken?: string | null;
  fetch?: typeof fetch;
  runtime?: Omit<ImageRuntimeOptions, 'env'>;
}

interface Harness {
  service: ImageService;
  serviceId: string;
  db: Database;
  store: ReturnType<typeof createProvidersStore>;
  events: Recorded[];
  close(): void;
}

const REQUEST_ID = '00000000-0000-4000-8000-000000000011';

async function createHarness(options: HarnessOptions): Promise<Harness> {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const bus = createEventBus();
  const events: Recorded[] = [];
  const logger = recordingLogger(events);
  const store = createProvidersStore(join(temp.dir, 'providers.json'));
  const service = createImageService(
    {
      dataDir: temp.dir,
      db: opened.db,
      bus,
      logger,
      shutdown: new AbortController().signal,
      providers: store,
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
  const created = await service.createService({
    requestId: REQUEST_ID,
    baseRevision: 'absent',
    name: '测试出图',
    protocol: options.protocol ?? 'unwritten-image',
    baseUrl: options.baseUrl,
    apiKey: options.apiKey ?? null,
    model: options.model ?? null,
    openai: options.openai ?? null,
    launcher:
      options.launcherUrl === undefined
        ? null
        : { baseUrl: options.launcherUrl, apiKey: options.launcherToken ?? null },
    idleMinutes: options.launcherUrl === undefined ? null : 30,
  });
  return {
    service,
    serviceId: created.serviceId,
    db: opened.db,
    store,
    events,
    close() {
      opened.close();
      temp.cleanup();
    },
  };
}

async function addImageService(
  harness: Harness,
  input: Partial<CreateImageServiceInput> & { baseUrl: string },
): Promise<string> {
  const created = await harness.service.createService({
    requestId: randomUUID(),
    baseRevision: harness.service.listServices().revision,
    name: '第二个出图',
    protocol: 'unwritten-image',
    apiKey: null,
    model: null,
    openai: null,
    launcher: null,
    idleMinutes: null,
    ...input,
  });
  return created.serviceId;
}

function generateInput(serviceId: string, overrides: Partial<ImageGenerateInput> = {}): ImageGenerateInput {
  return {
    serviceId,
    prompt: 'a quiet ferry pier at dusk',
    negativePrompt: 'text, watermark',
    references: [],
    aspect: '3:2',
    size: { width: 1536, height: 1024 },
    quality: 'best',
    seed: 42,
    signal: new AbortController().signal,
    ref: { workId: null, kind: 'illustration', id: null },
    manual: true,
    ...overrides,
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

describe('image engine', () => {
  it('unwritten-image 出一张图并记录一次成功调用', async () => {
    const server = await startFakeImageServer();
    const harness = await createHarness({ baseUrl: server.url, apiKey: server.token });
    try {
      const result = await harness.service.generate(generateInput(harness.serviceId));
      expect(result).toMatchObject({ width: 1536, height: 1024, mime: 'image/png', serviceId: harness.serviceId });
      const rows = harness.db.select().from(imageCalls).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'ok',
        protocol: 'unwritten-image',
        quality: 'best',
        referenceCount: 0,
        error: null,
      });
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('按能力去掉 seed 和 negativePrompt，能力支持时保留', async () => {
    const server = await startFakeImageServer({ capabilities: { seed: false, negativePrompt: false } });
    const harness = await createHarness({ baseUrl: server.url, apiKey: server.token });
    try {
      await harness.service.generate(generateInput(harness.serviceId, { seed: 42, negativePrompt: 'blurry' }));
      const first = server.requests.find((request) => request.method === 'POST')?.body as Record<string, unknown>;
      expect(first).not.toHaveProperty('seed');
      expect(first).not.toHaveProperty('negativePrompt');

      server.setCapabilities({ seed: true, negativePrompt: true });
      await harness.service.generate(generateInput(harness.serviceId, { seed: 42, negativePrompt: 'blurry' }));
      const posts = server.requests.filter((request) => request.method === 'POST');
      expect(posts).toHaveLength(2);
      expect(posts[1]?.body).toMatchObject({ seed: 42, negativePrompt: 'blurry' });
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('fast 预览不带 size', async () => {
    const server = await startFakeImageServer();
    const harness = await createHarness({ baseUrl: server.url, apiKey: server.token });
    try {
      const result = await harness.service.generate(
        generateInput(harness.serviceId, { quality: 'fast', size: null, seed: null }),
      );
      const body = server.requests.find((request) => request.method === 'POST')?.body as Record<string, unknown>;
      expect(body).not.toHaveProperty('size');
      expect(result).toMatchObject({ width: 1088, height: 720 });
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('只有 best 档的服务把 fast 请求改用 best 并如实记录', async () => {
    const server = await startFakeImageServer({ capabilities: { qualities: ['best'] } });
    const harness = await createHarness({ baseUrl: server.url, apiKey: server.token });
    try {
      const preview = await harness.service.generate(
        generateInput(harness.serviceId, {
          quality: 'fast',
          size: null,
          seed: null,
          ref: { workId: null, kind: 'portrait', id: null },
        }),
      );
      const testImage = await harness.service.generate(
        generateInput(harness.serviceId, {
          quality: 'fast',
          size: null,
          seed: null,
          ref: { workId: null, kind: 'test', id: null },
        }),
      );
      expect(preview).toMatchObject({ width: 1088, height: 720 });
      expect(testImage).toMatchObject({ width: 1088, height: 720 });

      const posts = server.requests
        .filter((request) => request.method === 'POST')
        .map((request) => request.body as Record<string, unknown>);
      expect(posts).toHaveLength(2);
      for (const body of posts) {
        expect(body.quality).toBe('best');
        expect(body).not.toHaveProperty('size');
      }
      const rows = harness.db.select().from(imageCalls).all();
      expect(rows.map((row) => row.quality)).toEqual(['best', 'best']);
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('未知的未就绪原因不写进诊断，已知原因照常记录', async () => {
    const sentinel = 'HOSTILE-REASON-7f3a';
    const server = await startFakeImageServer();
    const harness = await createHarness({ baseUrl: server.url, apiKey: server.token });
    try {
      server.setReady(false, sentinel);
      const hostile = await harness.service.testService({
        serviceId: harness.serviceId,
        target: 'service',
        paid: false,
      });
      expect(hostile).toMatchObject({
        ok: false,
        code: 'image_not_ready',
        service: { ready: false, notReadyReason: null },
      });
      expect(JSON.stringify(harness.events)).not.toContain(sentinel);
      expect(harness.service.listServices().services[0]?.probe).toMatchObject({
        result: 'not_ready',
        notReadyReason: null,
      });

      server.setReady(false, 'out_of_memory');
      const known = await harness.service.testService({
        serviceId: harness.serviceId,
        target: 'service',
        paid: false,
      });
      expect(known).toMatchObject({
        ok: false,
        code: 'image_out_of_memory',
        service: { ready: false, notReadyReason: 'out_of_memory' },
      });
      const probes = harness.events.filter((event) => event.event === 'image.service.probe');
      expect(probes).toHaveLength(2);
      expect(probes[0]?.data).toMatchObject({ result: 'not_ready' });
      expect(probes[0]?.data).not.toHaveProperty('reason');
      expect(probes[1]?.data).toMatchObject({ result: 'not_ready', reason: 'out_of_memory' });
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('离线后自动请求不再发出网络请求，手动请求仍探测', async () => {
    const baseFetch = createNetFetch();
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = (input, init) => {
      fetchCalls += 1;
      return baseFetch(input, init);
    };
    const server = await startFakeImageServer();
    const harness = await createHarness({
      baseUrl: server.url,
      apiKey: server.token,
      fetch: fetchImpl,
      runtime: { now: () => 1_000_000 },
    });
    try {
      await server.close();
      await expect(harness.service.generate(generateInput(harness.serviceId, { manual: false }))).rejects.toMatchObject(
        {
          code: 'image_offline',
        },
      );
      expect(fetchCalls).toBeGreaterThan(0);

      fetchCalls = 0;
      await expect(harness.service.generate(generateInput(harness.serviceId, { manual: false }))).rejects.toMatchObject(
        {
          code: 'image_offline',
        },
      );
      expect(fetchCalls).toBe(0);

      await expect(harness.service.generate(generateInput(harness.serviceId, { manual: true }))).rejects.toMatchObject({
        code: 'image_offline',
      });
      expect(fetchCalls).toBeGreaterThan(0);
    } finally {
      harness.close();
    }
  });

  it('离线时通过启动器唤醒后出图', async () => {
    const server = await startFakeImageServer();
    const launcher = await startFakeLauncher();
    let online = false;
    const baseFetch = createNetFetch();
    const fetchImpl: typeof fetch = (input, init) =>
      !online && urlOf(input).startsWith(server.url)
        ? Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
        : baseFetch(input, init);
    const harness = await createHarness({
      baseUrl: server.url,
      apiKey: server.token,
      launcherUrl: launcher.url,
      launcherToken: launcher.token,
      fetch: fetchImpl,
      runtime: { wakePollMs: 10 },
    });
    launcher.script([{ state: 'running', afterMs: 10 }]);
    const timer = setTimeout(() => {
      online = true;
    }, 30);
    try {
      const result = await harness.service.generate(generateInput(harness.serviceId, { manual: false }));
      expect(result).toMatchObject({ width: 1536, height: 1024 });
      expect(launcher.startCalls()).toBe(1);
    } finally {
      clearTimeout(timer);
      harness.close();
      await launcher.close();
      await server.close();
    }
  });

  it('调用方已中止时不启动唤醒，未中止时照常启动', async () => {
    const launcher = await startFakeLauncher();
    launcher.script([{ state: 'starting', afterMs: 0 }]);
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    const store = createProvidersStore(join(temp.dir, 'providers.json'));
    const file = emptyProvidersFile();
    file.imageServices = [
      {
        id: 'image-test-000001',
        name: '测试出图',
        protocol: 'unwritten-image',
        baseUrl: 'http://127.0.0.1:1',
        launcher: { baseUrl: launcher.url, apiKey: launcher.token },
        idleMinutes: 30,
      },
    ];
    store.write(file);
    const shutdown = new AbortController().signal;
    const offline: ProbeOutcome = {
      record: {
        at: Date.now(),
        result: 'offline',
        notReadyReason: null,
        implementation: null,
        model: null,
        capabilities: null,
      },
      error: new ImageError('image_offline', 'transport'),
    };
    const prober: Prober = {
      async probe() {
        return offline;
      },
      offlineSince() {
        return null;
      },
    };
    const waker = createWaker({
      store,
      logger: recordingLogger([]),
      bus: createEventBus(),
      shutdown,
      env: {},
      probe: (entry, signal) => prober.probe(entry, signal),
      pollMs: 10,
      timeoutMs: 100,
    });
    const engine = createImageEngine({
      store,
      cache: { get: () => null, set: () => undefined, delete: () => undefined },
      queue: createImageQueue(),
      prober,
      waker,
      db: opened.db,
      logger: recordingLogger([]),
      shutdown,
      env: {},
      pollIntervalMs: 5,
      jobTimeoutMs: 1_000,
    });
    try {
      const aborted = new AbortController();
      aborted.abort();
      await expect(
        engine.prepareGeneration('image-test-000001', { manual: false, signal: aborted.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      await delay(50);
      expect(launcher.startCalls()).toBe(0);

      const controller = new AbortController();
      const live = engine.prepareGeneration('image-test-000001', { manual: false, signal: controller.signal });
      await waitFor(() => launcher.startCalls() === 1);
      controller.abort();
      await expect(live).rejects.toMatchObject({ name: 'AbortError' });
      await engine.whenIdle();
      expect(launcher.startCalls()).toBe(1);
    } finally {
      opened.close();
      temp.cleanup();
      await launcher.close();
    }
  });

  it('三个请求同时等待唤醒时只启动一次', async () => {
    const server = await startFakeImageServer();
    const launcher = await startFakeLauncher();
    let online = false;
    const baseFetch = createNetFetch();
    const fetchImpl: typeof fetch = (input, init) =>
      !online && urlOf(input).startsWith(server.url)
        ? Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))
        : baseFetch(input, init);
    const harness = await createHarness({
      baseUrl: server.url,
      apiKey: server.token,
      launcherUrl: launcher.url,
      launcherToken: launcher.token,
      fetch: fetchImpl,
      runtime: { wakePollMs: 10 },
    });
    launcher.script([{ state: 'running', afterMs: 20 }]);
    const timer = setTimeout(() => {
      online = true;
    }, 10);
    try {
      const signal = new AbortController().signal;
      const results = await Promise.all(
        [0, 1, 2].map(() => harness.service.prepareGeneration(harness.serviceId, { manual: false, signal })),
      );
      expect(results).toHaveLength(3);
      for (const capabilities of results) expect(capabilities.aspects).toContain('3:2');
      expect(launcher.startCalls()).toBe(1);
    } finally {
      clearTimeout(timer);
      harness.close();
      await launcher.close();
      await server.close();
    }
  });

  it('同一个服务的任务依次执行，不同服务并行', async () => {
    const serverA = await startFakeImageServer({ jobDelayMs: 50 });
    const serverB = await startFakeImageServer({ jobDelayMs: 50 });
    const posts: string[] = [];
    const baseFetch = createNetFetch();
    const fetchImpl: typeof fetch = (input, init) => {
      if ((init?.method ?? 'GET') === 'POST') posts.push(urlOf(input));
      return baseFetch(input, init);
    };
    const harness = await createHarness({ baseUrl: serverA.url, apiKey: serverA.token, fetch: fetchImpl });
    const secondId = await addImageService(harness, { baseUrl: serverB.url, apiKey: serverB.token });
    const postCount = (url: string) => posts.filter((post) => post.startsWith(url)).length;
    try {
      const releaseFirst = serverA.holdNextJob();
      const firstOnA = harness.service.generate(generateInput(harness.serviceId, { prompt: 'first on a' }));
      await waitFor(() => postCount(serverA.url) === 1);

      const secondOnA = harness.service.generate(generateInput(harness.serviceId, { prompt: 'second on a' }));
      const firstOnB = harness.service.generate(generateInput(secondId, { prompt: 'first on b' }));
      await waitFor(() => postCount(serverB.url) === 1);
      await delay(50);
      expect(postCount(serverA.url)).toBe(1);

      releaseFirst();
      await Promise.all([firstOnA, secondOnA, firstOnB]);
      expect(postCount(serverA.url)).toBe(2);
    } finally {
      harness.close();
      await serverA.close();
      await serverB.close();
    }
  });

  it('刷新能力后原尺寸不再可用时以 image_output_format_unavailable 结束', async () => {
    const server = await startFakeImageServer();
    const baseFetch = createNetFetch();
    let posts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      if ((init?.method ?? 'GET') === 'POST' && urlOf(input).endsWith('/v1/jobs')) {
        posts += 1;
        if (posts === 1) {
          server.setCapabilities({ resolutions: { '3:2': { '720': { width: 1088, height: 720 } } } });
          return new Response(JSON.stringify({ error: { code: 'unsupported_size', message: 'unsupported' } }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
      }
      return baseFetch(input, init);
    };
    const harness = await createHarness({ baseUrl: server.url, apiKey: server.token, fetch: fetchImpl });
    try {
      await expect(harness.service.generate(generateInput(harness.serviceId))).rejects.toMatchObject({
        code: 'image_output_format_unavailable',
      });
      expect(posts).toBe(1);
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('能力刷新后原尺寸仍可用时用同一宽高重试一次', async () => {
    const server = await startFakeImageServer();
    const baseFetch = createNetFetch();
    let posts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      if ((init?.method ?? 'GET') === 'POST' && urlOf(input).endsWith('/v1/jobs')) {
        posts += 1;
        if (posts === 1) {
          return new Response(JSON.stringify({ error: { code: 'unsupported_size', message: 'unsupported' } }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
      }
      return baseFetch(input, init);
    };
    const harness = await createHarness({ baseUrl: server.url, apiKey: server.token, fetch: fetchImpl });
    try {
      const result = await harness.service.generate(generateInput(harness.serviceId));
      expect(result).toMatchObject({ width: 1536, height: 1024 });
      expect(posts).toBe(2);
      const bodies = server.requests.filter((request) => request.method === 'POST').map((request) => request.body);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toMatchObject({ size: { width: 1536, height: 1024 } });
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('出队时尺寸已消失则一次生成请求也不发', async () => {
    const server = await startFakeImageServer();
    const harness = await createHarness({ baseUrl: server.url, apiKey: server.token });
    try {
      const release = server.holdNextJob();
      const first = harness.service.generate(generateInput(harness.serviceId, { prompt: 'first job' }));
      await waitFor(() => server.requests.some((request) => request.method === 'POST'));
      const second = harness.service.generate(generateInput(harness.serviceId, { prompt: 'second job' }));
      server.setCapabilities({ resolutions: { '3:2': { '720': { width: 1088, height: 720 } } } });
      release();
      await first;
      await expect(second).rejects.toMatchObject({ code: 'image_output_format_unavailable' });
      expect(server.requests.filter((request) => request.method === 'POST')).toHaveLength(1);
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('出队时接收方模型已变则中止，不发给新模型', async () => {
    const fake = await startFakeOpenAiImages();
    const harness = await createHarness({
      baseUrl: fake.baseUrl,
      protocol: 'openai-images',
      model: 'gpt-image-2',
      openai: { maxReferences: 16, sizes: 'custom' },
    });
    try {
      fake.enqueue({ kind: 'hang' });
      const controller = new AbortController();
      const blocked = harness.service.generate(generateInput(harness.serviceId, { signal: controller.signal }));
      await waitFor(() => fake.requests.length === 1);
      await harness.service.updateService({
        baseRevision: harness.service.listServices().revision,
        serviceId: harness.serviceId,
        name: '测试出图',
        key: { action: 'keep' },
        model: 'chatgpt-image-latest',
        openai: { maxReferences: 16, sizes: 'fixed' },
        launcher: { action: 'keep', key: { action: 'keep' } },
        idleMinutes: 30,
      });
      fake.enqueue({ kind: 'image', width: 1536, height: 1024 });
      controller.abort();
      await blocked.catch(() => undefined);
      const guarded = harness.service.generate(
        generateInput(harness.serviceId, { guard: { model: 'gpt-image-2', assertCurrent() {} } }),
      );
      await expect(guarded).rejects.toMatchObject({ name: 'AbortError' });
      expect(fake.requests.filter((request) => request.path.endsWith('/images/generations'))).toHaveLength(1);
    } finally {
      harness.close();
      await fake.close();
    }
  });

  it('接收方模型未变时守卫任务照常出图', async () => {
    const fake = await startFakeOpenAiImages();
    const harness = await createHarness({
      baseUrl: fake.baseUrl,
      protocol: 'openai-images',
      model: 'gpt-image-2',
      openai: { maxReferences: 16, sizes: 'custom' },
    });
    try {
      fake.enqueue({ kind: 'hang' });
      const controller = new AbortController();
      const blocked = harness.service.generate(generateInput(harness.serviceId, { signal: controller.signal }));
      await waitFor(() => fake.requests.length === 1);
      fake.enqueue({ kind: 'image', width: 1536, height: 1024 });
      controller.abort();
      await blocked.catch(() => undefined);
      const result = await harness.service.generate(
        generateInput(harness.serviceId, { guard: { model: 'gpt-image-2', assertCurrent() {} } }),
      );
      expect(result).toMatchObject({ width: 1536, height: 1024 });
      expect(fake.requests.filter((request) => request.path.endsWith('/images/generations'))).toHaveLength(2);
    } finally {
      harness.close();
      await fake.close();
    }
  });

  it('OpenAI 兼容设置进入请求体', async () => {
    const fake = await startFakeOpenAiImages();
    const harness = await createHarness({
      baseUrl: fake.baseUrl,
      protocol: 'openai-images',
      model: 'test-image',
      openai: {
        maxReferences: 2,
        sizes: 'fixed',
        outputFormat: 'jpeg',
        responseFormat: 'b64_json',
        referenceTransport: 'inline',
        disableWatermark: true,
      },
    });
    try {
      fake.enqueue({ kind: 'image', width: 1024, height: 1024 });
      const result = await harness.service.generate(
        generateInput(harness.serviceId, {
          aspect: '1:1',
          size: { width: 1024, height: 1024 },
          references: [{ mime: 'image/png', bytes: pngBytes(2, 2) }],
        }),
      );
      expect(result).toMatchObject({ width: 1024, height: 1024 });
      expect(fake.requests[0]?.path).toBe('/v1/images/generations');
      expect(fake.requests[0]?.json).toMatchObject({
        output_format: 'jpeg',
        response_format: 'b64_json',
        watermark: false,
        image: [expect.stringMatching(/^data:image\/png;base64,/u)],
      });
    } finally {
      harness.close();
      await fake.close();
    }
  });

  it('参考图结果带元数据时拒绝，插图不拒绝', async () => {
    const server = await startFakeImageServer();
    const baseFetch = createNetFetch();
    let pending: { bytes: Uint8Array } | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = urlOf(input);
      if (pending !== null && (init?.method ?? 'GET') === 'GET') {
        if (/\/v1\/jobs\/[^/]+$/u.test(url)) {
          return new Response(JSON.stringify({ status: 'done', seed: 1, width: 1536, height: 1024, error: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (/\/v1\/jobs\/[^/]+\/image$/u.test(url)) {
          const response = new Response(pending.bytes, { headers: { 'content-type': 'image/png' } });
          pending = null;
          return response;
        }
      }
      return baseFetch(input, init);
    };
    const harness = await createHarness({ baseUrl: server.url, apiKey: server.token, fetch: fetchImpl });
    const metadata = pngBytes(1536, 1024, { textChunk: 'workflow: secret' });
    try {
      pending = { bytes: metadata };
      await expect(
        harness.service.generate(
          generateInput(harness.serviceId, { ref: { workId: null, kind: 'portrait', id: null } }),
        ),
      ).rejects.toMatchObject({ code: 'image_invalid_response' });

      pending = { bytes: metadata };
      const result = await harness.service.generate(
        generateInput(harness.serviceId, { ref: { workId: null, kind: 'illustration', id: null } }),
      );
      expect(result).toMatchObject({ width: 1536, height: 1024 });
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('结果宽高与请求不同时以 image_invalid_response 结束', async () => {
    const server = await startFakeImageServer();
    const baseFetch = createNetFetch();
    let pending: Uint8Array | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = urlOf(input);
      if (pending !== null && (init?.method ?? 'GET') === 'GET') {
        if (/\/v1\/jobs\/[^/]+$/u.test(url)) {
          return new Response(JSON.stringify({ status: 'done', seed: 1, width: 1024, height: 1024, error: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (/\/v1\/jobs\/[^/]+\/image$/u.test(url)) {
          const response = new Response(pending, { headers: { 'content-type': 'image/png' } });
          pending = null;
          return response;
        }
      }
      return baseFetch(input, init);
    };
    const harness = await createHarness({ baseUrl: server.url, apiKey: server.token, fetch: fetchImpl });
    try {
      pending = pngBytes(1024, 1024);
      await expect(harness.service.generate(generateInput(harness.serviceId))).rejects.toMatchObject({
        code: 'image_invalid_response',
      });
    } finally {
      harness.close();
      await server.close();
    }
  });

  it('OpenAI 5xx 不重试，记为 image_outcome_unknown', async () => {
    const fake = await startFakeOpenAiImages();
    const harness = await createHarness({
      baseUrl: fake.baseUrl,
      protocol: 'openai-images',
      model: 'gpt-image-2',
      openai: { maxReferences: 16, sizes: 'custom' },
    });
    try {
      fake.enqueue({ kind: 'error', status: 500 });
      await expect(harness.service.generate(generateInput(harness.serviceId))).rejects.toMatchObject({
        code: 'image_outcome_unknown',
      });
      expect(fake.requests).toHaveLength(1);
      const rows = harness.db.select().from(imageCalls).all();
      expect(rows[0]).toMatchObject({ status: 'error', error: 'image_outcome_unknown' });
    } finally {
      harness.close();
      await fake.close();
    }
  });

  it('OpenAI 连接失败自动重试一次后仍以 image_offline 结束', async () => {
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = () => {
      fetchCalls += 1;
      return Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }));
    };
    const harness = await createHarness({
      baseUrl: 'http://127.0.0.1:9/v1',
      protocol: 'openai-images',
      model: 'gpt-image-2',
      openai: { maxReferences: 16, sizes: 'custom' },
      fetch: fetchImpl,
    });
    try {
      await expect(harness.service.generate(generateInput(harness.serviceId))).rejects.toMatchObject({
        code: 'image_offline',
      });
      expect(fetchCalls).toBe(2);
    } finally {
      harness.close();
    }
  });
});
