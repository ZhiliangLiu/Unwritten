import { describe, expect, it } from 'vitest';
import { createFetchRecorder, createGuardedFetch, RedirectBlockedError } from './fetch-guard.ts';
import { startFakeOpenAiServer } from '../test-support/fake-openai-server.ts';

describe('createGuardedFetch', () => {
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
