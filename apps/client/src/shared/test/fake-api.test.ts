import { ORPCError } from '@orpc/client';
import { describe, expect, it } from 'vitest';
import { createFakeApi } from './fake-api.ts';

describe('createFakeApi', () => {
  it('按访问路径调用 handler 并记录调用', async () => {
    const { api, calls } = createFakeApi({
      'works.list': () => [{ id: 'work-1' }],
      'works.create': (input) => input,
    });
    const workId = '3f192da6-4a75-4a9e-a12c-4f3f2f9c9f45';
    expect(await api.works.list()).toEqual([{ id: 'work-1' }]);
    expect(await api.works.create({ workId })).toEqual({ workId });
    expect(calls).toEqual([
      { path: 'works.list', input: undefined },
      { path: 'works.create', input: { workId } },
    ]);
  });

  it('没有 handler 时以 ORPCError 拒绝，事件流默认不结束', async () => {
    const { api } = createFakeApi({});
    await expect(api.works.list()).rejects.toBeInstanceOf(ORPCError);
    const iterator = await api.events.subscribe();
    expect(typeof iterator[Symbol.asyncIterator]).toBe('function');
  });
});
