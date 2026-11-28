import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createFetchRecorder, createGuardedFetch, createNetFetch, RedirectBlockedError } from './fetch.ts';
import { startFakeOpenAiServer } from '../test-support/fake-openai-server.ts';

describe('createGuardedFetch', () => {
  it('捕获请求与响应正文，超过上限时截断', async () => {
    const recorder = createFetchRecorder(true);
    const body = 'x'.repeat(1_000_010);
    const base = (async () => new Response(body, { status: 200 })) as typeof fetch;
    const guarded = createGuardedFetch(base, recorder);
    const response = await guarded('https://example.test/v1/chat', { method: 'post', body });
    await response.text();
    await recorder.flush();
    expect(recorder.exchanges).toHaveLength(1);
    expect(recorder.exchanges[0]?.method).toBe('POST');
    expect(recorder.exchanges[0]?.requestBody).toContain('[truncated]');
    expect(recorder.exchanges[0]?.responseBody).toContain('[truncated]');
  });

  it('没有 recorder 时也拦重定向', async () => {
    const base = (async () => new Response(null, { status: 302 })) as typeof fetch;
    await expect(createGuardedFetch(base)('https://example.test/v1/chat')).rejects.toBeInstanceOf(RedirectBlockedError);
  });

  it('把 302 变成 RedirectBlockedError，目标收不到请求', async () => {
    const first = await startFakeOpenAiServer();
    const second = await startFakeOpenAiServer();
    try {
      first.enqueue({ kind: 'redirect', status: 302, location: `${second.baseUrl}/chat/completions` });
      const recorder = createFetchRecorder();
      const guarded = createGuardedFetch(fetch, recorder);
      await expect(guarded(`${first.baseUrl}/chat/completions`, { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(
        RedirectBlockedError,
      );
      expect(recorder.redirected).toBe(true);
      expect(second.requests).toHaveLength(0);
    } finally {
      await first.close();
      await second.close();
    }
  });
});

describe('createNetFetch', () => {
  it('createNetFetch 拒绝跟随重定向', async () => {
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(302, { location: 'http://127.0.0.1:1/x' });
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('net fetch test server did not get a port');
    try {
      const request = createNetFetch()(`http://127.0.0.1:${address.port}/x`);
      await expect(request).rejects.toBeInstanceOf(RedirectBlockedError);
      const error = await request.catch((caught: unknown) => caught);
      expect(error).toMatchObject({ status: 302 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
