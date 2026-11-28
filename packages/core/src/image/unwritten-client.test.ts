import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ImageError } from './errors.ts';
import { IMAGE_MAX_BYTES } from './limits.ts';
import { createNetFetch } from '../net/fetch.ts';
import { createUnwrittenImageClient, type UnwrittenJobRequest } from './unwritten-client.ts';
import { startFakeImageServer, type FakeImageServer } from '../test-support/fake-image-server.ts';
import { validateImageBytes } from './validate.ts';

let server: FakeImageServer;
const baseFetch = createNetFetch();

function client(overrides: { fetch?: typeof fetch; sleep?: (ms: number, signal: AbortSignal) => Promise<void> } = {}) {
  return createUnwrittenImageClient({ baseUrl: server.url, token: server.token, ...overrides });
}

function job(overrides: Partial<UnwrittenJobRequest> = {}): UnwrittenJobRequest {
  return {
    idempotencyKey: randomUUID(),
    prompt: 'a quiet pier at dusk',
    negativePrompt: null,
    references: [],
    aspect: '3:2',
    size: null,
    quality: 'best',
    seed: null,
    ...overrides,
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

async function expectImageError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ImageError);
  expect((caught as ImageError).code).toBe(code);
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition was not met in time');
    await delay(5);
  }
}

beforeAll(async () => {
  server = await startFakeImageServer({ jobDelayMs: 5 });
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  server.requests.length = 0;
});

describe('createUnwrittenImageClient', () => {
  it('info 解析能力并带上令牌', async () => {
    const info = await client().info(signal());
    expect(info.ready).toBe(true);
    expect(info.capabilities.maxReferences).toBe(4);
    expect(info.capabilities.aspects).toContain('3:2');
    const recorded = server.requests[0];
    expect(recorded).toMatchObject({ method: 'GET', path: '/v1/info', authorization: `Bearer ${server.token}` });
  });

  it('run 依次提交、轮询、取图、释放', async () => {
    const result = await client().run(job(), { signal: signal(), pollIntervalMs: 5, jobTimeoutMs: 5_000 });
    const calls = server.requests.map((request) => `${request.method} ${request.path}`);
    expect(calls[0]).toBe('POST /v1/jobs');
    const id = calls[1]?.split('/')[3] ?? '';
    expect(calls[1]).toBe(`GET /v1/jobs/${id}`);
    expect(calls.filter((call) => call === `GET /v1/jobs/${id}`).length).toBeGreaterThan(0);
    expect(calls.at(-2)).toBe(`GET /v1/jobs/${id}/image`);
    expect(calls.at(-1)).toBe(`DELETE /v1/jobs/${id}`);
    expect(result.seed).toEqual(expect.any(Number));
    expect(validateImageBytes(result.bytes).ok).toBe(true);
  });

  it('size、seed、negativePrompt 为 null 时不进请求体，有值时进请求体', async () => {
    const bare = job({ negativePrompt: null, size: null, seed: null });
    const clientUnderTest = client();
    await clientUnderTest.run(bare, { signal: signal(), pollIntervalMs: 5, jobTimeoutMs: 5_000 });
    const without = server.requests[0]?.body as Record<string, unknown>;
    expect(without).not.toHaveProperty('size');
    expect(without).not.toHaveProperty('seed');
    expect(without).not.toHaveProperty('negativePrompt');

    server.requests.length = 0;
    const filled = job({ negativePrompt: 'blurry', size: { width: 1088, height: 720 }, seed: 7, aspect: '3:2' });
    await clientUnderTest.run(filled, { signal: signal(), pollIntervalMs: 5, jobTimeoutMs: 5_000 });
    const withValues = server.requests[0]?.body as Record<string, unknown>;
    expect(withValues).toMatchObject({ size: { width: 1088, height: 720 }, seed: 7, negativePrompt: 'blurry' });
  });

  it('提交遇到网络错误时用同一个请求体重发一次', async () => {
    const bodies: string[] = [];
    let first = true;
    const flakyFetch: typeof fetch = async (input, init) => {
      if (init?.method === 'POST') {
        bodies.push(init.body as string);
        if (first) {
          first = false;
          throw new TypeError('fetch failed');
        }
      }
      return baseFetch(input, init);
    };
    const result = await client({ fetch: flakyFetch }).run(job(), {
      signal: signal(),
      pollIntervalMs: 5,
      jobTimeoutMs: 5_000,
    });
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    const firstBody = JSON.parse(bodies[0] ?? '{}') as { idempotencyKey?: unknown };
    expect(firstBody.idempotencyKey).toEqual(expect.any(String));
    expect(server.requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  });

  it('队列满时按 Retry-After 等待后重发一次', async () => {
    server.respondNext(429, { error: { code: 'busy', message: 'busy' } }, { 'retry-after': '1' });
    const sleeps: number[] = [];
    const result = await client({
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    }).run(job(), { signal: signal(), pollIntervalMs: 5, jobTimeoutMs: 5_000 });
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(sleeps).toContain(1_000);
    expect(server.requests.filter((request) => request.method === 'POST')).toHaveLength(2);
  });

  it('任务因显存不足失败时映射成 image_out_of_memory', async () => {
    server.failNextJob('out_of_memory');
    await expectImageError(
      client().run(job(), { signal: signal(), pollIntervalMs: 5, jobTimeoutMs: 5_000 }),
      'image_out_of_memory',
    );
  });

  it('超过任务时限时抛 image_timeout 并取消任务', async () => {
    const release = server.holdNextJob();
    try {
      await expectImageError(
        client().run(job(), { signal: signal(), pollIntervalMs: 10, jobTimeoutMs: 120 }),
        'image_timeout',
      );
    } finally {
      release();
    }
    expect(server.requests.some((request) => request.method === 'DELETE')).toBe(true);
  });

  it('取图超过 IMAGE_MAX_BYTES 时停止读取', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const totalChunks = 80;
    let produced = 0;
    const oversized = async function* (): AsyncGenerator<Uint8Array> {
      for (let index = 0; index < totalChunks; index += 1) {
        produced += chunk.length;
        yield chunk;
      }
    };
    const streamingFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/image')) server.respondNext(200, oversized(), { 'content-type': 'image/png' });
      return baseFetch(input, init);
    };
    await expectImageError(
      client({ fetch: streamingFetch }).run(job(), { signal: signal(), pollIntervalMs: 5, jobTimeoutMs: 5_000 }),
      'image_invalid_response',
    );
    expect(produced).toBeGreaterThan(IMAGE_MAX_BYTES);
    expect(produced).toBeLessThan(IMAGE_MAX_BYTES * 2);
  });

  it('收到重定向时抛 image_redirected', async () => {
    server.respondNext(302, {}, { location: 'https://example.com/image.png' });
    await expectImageError(
      client().run(job(), { signal: signal(), pollIntervalMs: 5, jobTimeoutMs: 5_000 }),
      'image_redirected',
    );
  });

  it('signal 中止时取消任务并以 AbortError 结束', async () => {
    const release = server.holdNextJob();
    const controller = new AbortController();
    try {
      const running = client().run(job(), {
        signal: controller.signal,
        pollIntervalMs: 10,
        jobTimeoutMs: 30_000,
      });
      await waitFor(() =>
        server.requests.some((request) => request.method === 'GET' && request.path.startsWith('/v1/jobs/')),
      );
      controller.abort();
      let caught: unknown = null;
      try {
        await running;
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).name).toBe('AbortError');
    } finally {
      release();
    }
    expect(server.requests.some((request) => request.method === 'DELETE')).toBe(true);
  });
});
