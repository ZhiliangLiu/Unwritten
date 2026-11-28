import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { createNetFetch, RedirectBlockedError } from '../../net/fetch.ts';
import { parseServiceInfo, type ServiceInfo } from '../info.ts';
import { validateImageBytes } from '../validate.ts';
import { startFakeImageServer } from '../../test-support/fake-image-server.ts';
import { TINY_WEBP } from '../../test-support/image-bytes.ts';
import { conformanceTarget } from './target.ts';

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
const real = process.env.UNWRITTEN_IMAGE_CONFORMANCE_URL !== undefined;
const TEST_TIMEOUT = real ? 300_000 : 30_000;
const netFetch = createNetFetch();

let target: Awaited<ReturnType<typeof conformanceTarget>>;
let info: ServiceInfo;

function base(): string {
  return target.url.replace(/\/+$/u, '');
}

async function send(path: string, init: RequestInit & { authorization?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.authorization !== null) headers.authorization = init.authorization ?? `Bearer ${target.token}`;
  let response: Response;
  try {
    response = await netFetch(`${base()}${path}`, { ...init, headers });
  } catch (error) {
    if (error instanceof RedirectBlockedError) throw new Error(`unexpected redirect ${error.status}`);
    throw error;
  }
  expect(REDIRECT_STATUSES).not.toContain(response.status);
  return response;
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  const payload = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
  expect(payload.error?.code).toBe(code);
  expect(typeof payload.error?.message).toBe('string');
}

function jobBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idempotencyKey: `conformance-${Math.random().toString(36).slice(2, 12)}`,
    prompt: 'a quiet pier at dusk',
    aspect: '3:2',
    quality: 'best',
    ...overrides,
  };
}

async function postJob(body: Record<string, unknown>): Promise<Response> {
  return send('/v1/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForTerminal(id: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + TEST_TIMEOUT - 10_000;
  for (;;) {
    const response = await send(`/v1/jobs/${encodeURIComponent(id)}`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    if (payload.status === 'done' || payload.status === 'failed' || payload.status === 'cancelled') return payload;
    if (Date.now() > deadline) throw new Error(`job ${id} did not finish in time`);
    await delay(50);
  }
}

function smallestSize(aspect: string): { width: number; height: number } | null {
  let smallest: { width: number; height: number } | null = null;
  for (const size of Object.values(info.capabilities.resolutions[aspect] ?? {})) {
    if (smallest === null || size.width * size.height < smallest.width * smallest.height) smallest = size;
  }
  return smallest;
}

beforeAll(async () => {
  target = await conformanceTarget('UNWRITTEN_IMAGE', startFakeImageServer);
  const response = await send('/v1/info');
  expect(response.status).toBe(200);
  const parsed = parseServiceInfo(await response.json());
  if (!parsed.ok) throw new Error(parsed.issue);
  info = parsed.info;
});

afterAll(async () => {
  await target?.close();
});

describe('unwritten-image/1 conformance', () => {
  it('不带令牌请求信息接口返回 401 unauthorized', { timeout: TEST_TIMEOUT }, async () => {
    const response = await send('/v1/info', { authorization: null });
    await expectError(response, 401, 'unauthorized');
  });

  it('带错误的令牌返回 401', { timeout: TEST_TIMEOUT }, async () => {
    const response = await send('/v1/info', { authorization: 'Bearer wrong-token-0123456789abcdef0123456789' });
    await expectError(response, 401, 'unauthorized');
  });

  it('信息接口返回可解析的能力，且没有 CORS 头', { timeout: TEST_TIMEOUT }, async () => {
    const response = await send('/v1/info');
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    const parsed = parseServiceInfo(await response.json());
    expect(parsed.ok).toBe(true);
  });

  it('任何响应都不是重定向', { timeout: TEST_TIMEOUT }, async () => {
    const infoResponse = await send('/v1/info');
    expect(REDIRECT_STATUSES).not.toContain(infoResponse.status);
    const jobResponse = await postJob(jobBody());
    expect(REDIRECT_STATUSES).not.toContain(jobResponse.status);
  });

  it('提交缺少 prompt 返回 400 invalid_request', { timeout: TEST_TIMEOUT }, async () => {
    const body = jobBody();
    delete body.prompt;
    const response = await postJob(body);
    await expectError(response, 400, 'invalid_request');
  });

  it('参考图张数超过 maxReferences 返回 400 too_many_references', { timeout: TEST_TIMEOUT }, async () => {
    const reference = { mime: 'image/webp', data: Buffer.from(TINY_WEBP).toString('base64') };
    const references = Array.from({ length: info.capabilities.maxReferences + 1 }, () => reference);
    const response = await postJob(jobBody({ references }));
    await expectError(response, 400, 'too_many_references');
  });

  it('单张参考图超过 maxReferenceBytes 返回 413 reference_too_large', { timeout: TEST_TIMEOUT }, async (context) => {
    const maxBytes = info.capabilities.maxReferenceBytes;
    if (maxBytes === null || maxBytes > 16 * 1024 * 1024) {
      context.skip('maxReferenceBytes exceeds 16 MiB, so the oversize probe is skipped');
      return;
    }
    const data = Buffer.alloc(maxBytes + 1).toString('base64');
    const response = await postJob(jobBody({ references: [{ mime: 'image/webp', data }] }));
    await expectError(response, 413, 'reference_too_large');
  });

  it('不支持的比例返回 400 unsupported_aspect', { timeout: TEST_TIMEOUT }, async () => {
    const aspect = info.capabilities.aspects.includes('7:5') ? '97:89' : '7:5';
    const response = await postJob(jobBody({ aspect }));
    await expectError(response, 400, 'unsupported_aspect');
  });

  it('同一个幂等键和同一个请求体返回同一个任务 id', { timeout: TEST_TIMEOUT }, async () => {
    const body = jobBody();
    const first = await postJob(body);
    expect(first.status).toBe(202);
    const second = await postJob(body);
    expect(second.status).toBe(202);
    const firstPayload = (await first.json()) as { id?: unknown };
    const secondPayload = (await second.json()) as { id?: unknown };
    expect(typeof firstPayload.id).toBe('string');
    expect(secondPayload.id).toBe(firstPayload.id);
  });

  it('同一个幂等键配不同的请求体返回 409 idempotency_conflict', { timeout: TEST_TIMEOUT }, async () => {
    const body = jobBody();
    const first = await postJob(body);
    expect(first.status).toBe(202);
    const conflict = await postJob({ ...body, prompt: 'a different pier at dawn' });
    await expectError(conflict, 409, 'idempotency_conflict');
  });

  it('正常任务能取回合格的图片', { timeout: TEST_TIMEOUT }, async () => {
    const quality = info.capabilities.qualities.find((candidate) => candidate === 'best');
    if (quality === undefined) throw new Error('service does not report the required best quality');
    const aspect =
      info.capabilities.aspects.find((candidate) => info.capabilities.resolutions[candidate] !== undefined) ??
      info.capabilities.aspects[0];
    if (aspect === undefined) throw new Error('service reports no aspects');
    const size = smallestSize(aspect);
    const body = jobBody({ aspect, quality, ...(size === null ? {} : { size }) });
    const submitted = await postJob(body);
    expect(submitted.status).toBe(202);
    const { id } = (await submitted.json()) as { id: string };

    const status = await waitForTerminal(id);
    expect(status.status).toBe('done');
    if (info.capabilities.seed) expect(Number.isInteger(status.seed)).toBe(true);
    if (size !== null) {
      expect(status.width).toBe(size.width);
      expect(status.height).toBe(size.height);
    }

    const imageResponse = await send(`/v1/jobs/${encodeURIComponent(id)}/image`);
    expect(imageResponse.status).toBe(200);
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    const validated = validateImageBytes(bytes, { rejectMetadata: true });
    expect(validated.ok).toBe(true);
    if (size !== null && validated.ok) {
      expect(validated.image.width).toBe(size.width);
      expect(validated.image.height).toBe(size.height);
    }

    const deleted = await send(`/v1/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    const missing = await send(`/v1/jobs/${encodeURIComponent(id)}/image`);
    await expectError(missing, 404, 'not_found');
  });

  it('每个错误响应都是 { error: { code, message } } 的形状', { timeout: TEST_TIMEOUT }, async () => {
    const unauthorized = await send('/v1/info', { authorization: null });
    await expectError(unauthorized, 401, 'unauthorized');
    const invalid = await postJob(jobBody({ prompt: undefined }));
    await expectError(invalid, 400, 'invalid_request');
    const missing = await send(`/v1/jobs/${encodeURIComponent('missing-job')}`);
    await expectError(missing, 404, 'not_found');
  });
});
