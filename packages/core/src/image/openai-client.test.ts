import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OpenAiImageCompat } from '@unwritten/contracts';
import { ImageError } from './errors.ts';
import { createOpenAiImageClient, type OpenAiImageClient, type OpenAiImageRequest } from './openai-client.ts';
import { startFakeOpenAiImages, type FakeOpenAiImages } from '../test-support/fake-openai-images.ts';
import { TINY_WEBP, pngBytes } from '../test-support/image-bytes.ts';

const API_KEY = 'test-token-0123456789abcdef0123456789abcdef';
const MODEL = 'gpt-image-2';
const SIZE = { width: 1536, height: 1024 };

let server: FakeOpenAiImages;

beforeEach(async () => {
  server = await startFakeOpenAiImages({ apiKey: API_KEY });
});

afterEach(async () => {
  await server.close();
});

function client(
  options: { timeoutMs?: number; baseUrl?: string; compat?: Partial<OpenAiImageCompat> } = {},
): OpenAiImageClient {
  return createOpenAiImageClient({
    baseUrl: options.baseUrl ?? server.baseUrl,
    apiKey: API_KEY,
    model: MODEL,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.compat === undefined ? {} : { compat: options.compat }),
  });
}

function request(overrides: Partial<OpenAiImageRequest> = {}): OpenAiImageRequest {
  return { prompt: 'a quiet pier at dusk', references: [], size: SIZE, quality: 'best', ...overrides };
}

function idleSignal(): AbortSignal {
  return new AbortController().signal;
}

async function imageError(promise: Promise<unknown>): Promise<ImageError> {
  const caught = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(ImageError);
  return caught as ImageError;
}

async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('closed port probe did not get a port');
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

describe('createOpenAiImageClient.generate', () => {
  it('没有参考图时走 generations，并逐键发送请求体', async () => {
    server.enqueue({ kind: 'image', width: 4, height: 3 });
    const result = await client().generate(request(), idleSignal());

    expect(Buffer.from(result.bytes).equals(Buffer.from(pngBytes(4, 3)))).toBe(true);
    expect(server.requests).toHaveLength(1);
    const [recorded] = server.requests;
    expect(recorded?.path).toBe('/v1/images/generations');
    expect(recorded?.authorization).toBe(`Bearer ${API_KEY}`);
    expect(recorded?.contentType).toContain('application/json');
    expect(recorded?.json).toEqual({
      model: MODEL,
      prompt: 'a quiet pier at dusk',
      n: 1,
      size: '1536x1024',
      quality: 'high',
      output_format: 'webp',
      moderation: 'auto',
    });
  });

  it('fast 质量映射为 low', async () => {
    server.enqueue({ kind: 'image', width: 1, height: 1 });
    await client().generate(request({ quality: 'fast' }), idleSignal());
    expect(server.requests[0]?.json).toMatchObject({ quality: 'low' });
  });

  it('兼容设置覆盖输出格式、响应格式和水印', async () => {
    server.enqueue({ kind: 'image', width: 4, height: 3 });
    await client({
      compat: { outputFormat: 'jpeg', responseFormat: 'b64_json', disableWatermark: true },
    }).generate(request(), idleSignal());

    expect(server.requests[0]?.json).toEqual({
      model: MODEL,
      prompt: 'a quiet pier at dusk',
      n: 1,
      size: '1536x1024',
      quality: 'high',
      output_format: 'jpeg',
      moderation: 'auto',
      response_format: 'b64_json',
      watermark: false,
    });
  });

  it('参考图内联时走 generations，JSON 里带 data URL', async () => {
    server.enqueue({ kind: 'image', width: 2, height: 2 });
    const references = [{ mime: 'image/png', bytes: pngBytes(2, 2) }];
    await client({
      compat: { outputFormat: 'jpeg', responseFormat: 'b64_json', referenceTransport: 'inline' },
    }).generate(request({ prompt: '{{ref:1}} holds an umbrella', references }), idleSignal());

    expect(server.requests).toHaveLength(1);
    const [recorded] = server.requests;
    expect(recorded?.path).toBe('/v1/images/generations');
    expect(recorded?.contentType).toContain('application/json');
    expect(recorded?.fields).toEqual({});
    expect(recorded?.json).toMatchObject({
      prompt: 'input image 1 holds an umbrella',
      output_format: 'jpeg',
      response_format: 'b64_json',
      image: [`data:image/png;base64,${Buffer.from(references[0]!.bytes).toString('base64')}`],
    });
  });

  it('编辑接口只使用输出格式，不发送 response_format 和 watermark', async () => {
    server.enqueue({ kind: 'image', width: 2, height: 2 });
    const references = [{ mime: 'image/png', bytes: pngBytes(2, 2) }];
    await client({
      compat: { outputFormat: 'jpeg', responseFormat: 'b64_json', disableWatermark: true },
    }).generate(request({ references }), idleSignal());

    expect(server.requests[0]?.path).toBe('/v1/images/edits');
    expect(server.requests[0]?.fields).toMatchObject({ output_format: 'jpeg' });
    expect(server.requests[0]?.fields).not.toHaveProperty('response_format');
    expect(server.requests[0]?.fields).not.toHaveProperty('watermark');
  });

  it('带参考图时走 edits，multipart 的顺序和类型与输入一致', async () => {
    server.enqueue({ kind: 'image', width: 2, height: 2 });
    const references = [
      { mime: 'image/png', bytes: pngBytes(2, 2) },
      { mime: 'image/webp', bytes: TINY_WEBP },
    ];
    await client().generate(request({ prompt: '{{ref:2}} hands an umbrella to {{ref:1}}', references }), idleSignal());

    expect(server.requests).toHaveLength(1);
    const [recorded] = server.requests;
    expect(recorded?.path).toBe('/v1/images/edits');
    expect(recorded?.contentType).toMatch(/^multipart\/form-data/u);
    expect(recorded?.json).toBeNull();
    expect(recorded?.fields).toEqual({
      model: MODEL,
      prompt: 'input image 2 hands an umbrella to input image 1',
      n: '1',
      size: '1536x1024',
      quality: 'high',
      output_format: 'webp',
    });
    expect(recorded?.images).toEqual([
      { name: 'image[]', type: 'image/png', filename: 'ref-1.png', bytes: references[0]!.bytes.length },
      { name: 'image[]', type: 'image/webp', filename: 'ref-2.webp', bytes: references[1]!.bytes.length },
    ]);
  });

  it('解析 usage 的 token 数，缺省为 null', async () => {
    server.enqueue({ kind: 'image', width: 1, height: 1, usage: { input_tokens: 12, output_tokens: 34 } });
    const withUsage = await client().generate(request(), idleSignal());
    expect(withUsage.inputTokens).toBe(12);
    expect(withUsage.outputTokens).toBe(34);

    server.enqueue({ kind: 'image', width: 1, height: 1 });
    const withoutUsage = await client().generate(request(), idleSignal());
    expect(withoutUsage.inputTokens).toBeNull();
    expect(withoutUsage.outputTokens).toBeNull();
  });

  it('401 和 403 映射为 image_unauthorized', async () => {
    server.enqueue({ kind: 'error', status: 401 });
    server.enqueue({ kind: 'error', status: 403 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const error = await imageError(client().generate(request(), idleSignal()));
      expect(error).toMatchObject({ code: 'image_unauthorized', kind: 'final' });
    }
  });

  it('额度用尽的 429 映射为 image_quota', async () => {
    server.enqueue({ kind: 'error', status: 429, code: 'insufficient_quota' });
    const error = await imageError(client().generate(request(), idleSignal()));
    expect(error).toMatchObject({ code: 'image_quota', kind: 'final' });
  });

  it('其他 429 映射为 image_rate_limited，并读取 Retry-After', async () => {
    server.enqueue({ kind: 'error', status: 429, code: 'rate_limit_exceeded', retryAfter: '3' });
    const withHeader = await imageError(client().generate(request(), idleSignal()));
    expect(withHeader).toMatchObject({ code: 'image_rate_limited', kind: 'busy', retryAfterMs: 3000 });

    server.enqueue({ kind: 'error', status: 429, code: 'rate_limit_exceeded' });
    const withoutHeader = await imageError(client().generate(request(), idleSignal()));
    expect(withoutHeader).toMatchObject({ code: 'image_rate_limited', kind: 'busy', retryAfterMs: 2000 });
  });

  it('400 的 moderation_blocked 映射为 image_refused', async () => {
    server.enqueue({ kind: 'error', status: 400, code: 'moderation_blocked' });
    const error = await imageError(client().generate(request(), idleSignal()));
    expect(error).toMatchObject({ code: 'image_refused', kind: 'final' });
  });

  it('拒绝 size 的 400 映射为 image_output_format_unavailable', async () => {
    server.enqueue({ kind: 'error', status: 400, code: 'size' });
    const error = await imageError(client().generate(request(), idleSignal()));
    expect(error).toMatchObject({ code: 'image_output_format_unavailable', kind: 'format' });
  });

  it('其他 400 映射为 image_invalid_request', async () => {
    server.enqueue({ kind: 'error', status: 400, code: 'invalid_value' });
    const error = await imageError(client().generate(request(), idleSignal()));
    expect(error).toMatchObject({ code: 'image_invalid_request', kind: 'final' });
  });

  it('5xx 映射为 image_outcome_unknown，标记为已提交', async () => {
    server.enqueue({ kind: 'error', status: 503 });
    const error = await imageError(client().generate(request(), idleSignal()));
    expect(error).toMatchObject({ code: 'image_outcome_unknown', kind: 'final', submitted: true });
  });

  it('重定向映射为 image_redirected', async () => {
    server.enqueue({ kind: 'redirect' });
    const error = await imageError(client().generate(request(), idleSignal()));
    expect(error).toMatchObject({ code: 'image_redirected', kind: 'final' });
  });

  it('响应体超过上限时抛 image_invalid_response', async () => {
    server.enqueue({ kind: 'oversize' });
    const error = await imageError(client().generate(request(), idleSignal()));
    expect(error).toMatchObject({ code: 'image_invalid_response', kind: 'final' });
  });

  it('超时抛 image_timeout', async () => {
    server.enqueue({ kind: 'hang' });
    const error = await imageError(client({ timeoutMs: 50 }).generate(request(), idleSignal()));
    expect(error).toMatchObject({ code: 'image_timeout' });
  });

  it('调用方中止抛 AbortError，不是 image_timeout', async () => {
    server.enqueue({ kind: 'hang' });
    const controller = new AbortController();
    const pending = client().generate(request(), controller.signal);
    while (server.requests.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    const caught = await pending.catch((error: unknown) => error);
    expect(caught).not.toBeInstanceOf(ImageError);
    expect(caught).toMatchObject({ name: 'AbortError' });
  });

  it('连接被拒抛 image_offline，标记为未提交', async () => {
    const port = await closedPort();
    const error = await imageError(
      client({ baseUrl: `http://127.0.0.1:${port}/v1` }).generate(request(), idleSignal()),
    );
    expect(error).toMatchObject({ code: 'image_offline', kind: 'transport', submitted: false });
  });

  it('没有 apiKey 时不带 authorization', async () => {
    const anonymous = await startFakeOpenAiImages();
    try {
      anonymous.enqueue({ kind: 'image', width: 1, height: 1 });
      const anonymousClient = createOpenAiImageClient({ baseUrl: anonymous.baseUrl, apiKey: undefined, model: MODEL });
      await anonymousClient.generate(request(), idleSignal());
      expect(anonymous.requests[0]?.authorization).toBeNull();
    } finally {
      await anonymous.close();
    }
  });

  it('响应读到一半断开时抛 image_outcome_unknown，标记为已提交', async () => {
    const brokenFetch: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"data":['));
            controller.error(new Error('socket closed'));
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const brokenClient = createOpenAiImageClient({
      baseUrl: 'http://example.test/v1',
      apiKey: undefined,
      model: MODEL,
      fetch: brokenFetch,
    });
    const error = await imageError(brokenClient.generate(request(), idleSignal()));
    expect(error).toMatchObject({ code: 'image_outcome_unknown', kind: 'final', submitted: true });
  });

  it('错误信息不带提示词', async () => {
    server.enqueue({ kind: 'error', status: 400, code: 'invalid_value' });
    const prompt = 'secret prompt text 123';
    const error = await imageError(client().generate(request({ prompt }), idleSignal()));
    expect(server.requests[0]?.json).toMatchObject({ prompt });
    expect(error.message).toBe('image_invalid_request');
    expect(error.message).not.toContain('secret');
  });
});

describe('createOpenAiImageClient.listModels', () => {
  it('GET /models 带令牌并接受成功响应', async () => {
    await client().listModels(idleSignal());
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.path).toBe('/v1/models');
    expect(server.requests[0]?.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('非 2xx 按同一套错误映射', async () => {
    server.enqueue({ kind: 'error', status: 401 });
    const error = await imageError(client().listModels(idleSignal()));
    expect(error).toMatchObject({ code: 'image_unauthorized', kind: 'final' });
  });
});
