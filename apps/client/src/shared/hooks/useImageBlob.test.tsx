import type { ReactNode } from 'react';
import { ORPCError } from '@orpc/client';
import type { ImageFileInput } from '@unwritten/contracts';
import { cleanup, render, renderHook } from 'vitest-browser-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client.ts';
import { ApiProvider } from '../api/context.tsx';
import { createFakeApi } from '../test/fake-api.ts';
import { IMAGE_BLOB_CACHE_SIZE, resetImageBlobCacheForTests, useImageBlob } from './useImageBlob.ts';

const routeId = '2f1d5c4a-8b7e-4a3f-9c2d-1e0f9a8b7c6d';

function illustrationInput(illustrationId: string): ImageFileInput {
  return { view: { kind: 'route', routeId }, image: { kind: 'illustration', illustrationId } };
}

function wrapperFor(api: ApiClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ApiProvider value={api}>{children}</ApiProvider>;
  };
}

function Consumer({ illustrationId }: { illustrationId: string }) {
  const state = useImageBlob(illustrationInput(illustrationId), 1);
  return <output data-ready={state.status === 'ready' ? 'true' : 'false'}>{state.url ?? ''}</output>;
}

function Consumers({ illustrationIds }: { illustrationIds: string[] }) {
  return (
    <>
      {illustrationIds.map((illustrationId) => (
        <Consumer key={illustrationId} illustrationId={illustrationId} />
      ))}
    </>
  );
}

function spyOnObjectUrls(created: string[], revoked: string[]): void {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    const url = `blob:test-${created.length + 1}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
    revoked.push(url);
  });
}

describe('useImageBlob', () => {
  afterEach(async () => {
    await cleanup();
    resetImageBlobCacheForTests();
    vi.restoreAllMocks();
  });

  it('两个组件用同一个输入只取一次图', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    spyOnObjectUrls(created, revoked);
    const gate = Promise.withResolvers<void>();
    let calls = 0;
    const fake = createFakeApi({
      'image.file': async () => {
        calls += 1;
        await gate.promise;
        return new Blob(['image'], { type: 'image/png' });
      },
    });
    const wrapper = wrapperFor(fake.api);
    const input = illustrationInput(crypto.randomUUID());

    const first = await renderHook(() => useImageBlob(input, 1), { wrapper });
    const second = await renderHook(() => useImageBlob(input, 1), { wrapper });
    await vi.waitFor(() => expect(calls).toBe(1));
    gate.resolve();

    await vi.waitFor(() => {
      expect(first.result.current.status).toBe('ready');
      expect(second.result.current.status).toBe('ready');
    });
    expect(first.result.current.url).toBe(second.result.current.url);
    expect(calls).toBe(1);
    expect(created).toHaveLength(1);
  });

  it('缓存命中时不再请求', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    spyOnObjectUrls(created, revoked);
    let calls = 0;
    const fake = createFakeApi({
      'image.file': () => {
        calls += 1;
        return new Blob(['image'], { type: 'image/png' });
      },
    });
    const wrapper = wrapperFor(fake.api);
    const input = illustrationInput(crypto.randomUUID());

    const first = await renderHook(() => useImageBlob(input, 1), { wrapper });
    await vi.waitFor(() => expect(first.result.current.status).toBe('ready'));

    const second = await renderHook(() => useImageBlob(input, 1), { wrapper });
    await vi.waitFor(() => expect(second.result.current.status).toBe('ready'));

    expect(calls).toBe(1);
    expect(second.result.current.url).toBe(first.result.current.url);
    expect(created).toHaveLength(1);
  });

  it('version 变了就重新取图', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    spyOnObjectUrls(created, revoked);
    const fake = createFakeApi({ 'image.file': () => new Blob(['image'], { type: 'image/png' }) });
    const wrapper = wrapperFor(fake.api);
    const input = illustrationInput(crypto.randomUUID());

    const hook = await renderHook((props?: { version: number }) => useImageBlob(input, props?.version ?? 1), {
      wrapper,
      initialProps: { version: 1 },
    });
    await vi.waitFor(() => expect(hook.result.current.status).toBe('ready'));
    const firstUrl = hook.result.current.url;

    await hook.rerender({ version: 2 });
    await vi.waitFor(() => {
      expect(hook.result.current.status).toBe('ready');
      expect(hook.result.current.url).not.toBe(firstUrl);
    });
    expect(created).toHaveLength(2);
  });

  it('淘汰最久没用且无人使用的图，不吊销正在用的 URL', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    spyOnObjectUrls(created, revoked);
    const fake = createFakeApi({ 'image.file': () => new Blob(['image'], { type: 'image/png' }) });
    const wrapper = wrapperFor(fake.api);
    const illustrationIds = Array.from({ length: IMAGE_BLOB_CACHE_SIZE + 1 }, () => crypto.randomUUID());

    const screen = await render(<Consumers illustrationIds={illustrationIds} />, { wrapper });
    await vi.waitFor(() => {
      expect(screen.container.querySelectorAll('[data-ready="true"]')).toHaveLength(illustrationIds.length);
    });
    expect(revoked).toEqual([]);
    await screen.unmount();

    const nextId = crypto.randomUUID();
    const next = await renderHook(() => useImageBlob(illustrationInput(nextId), 1), { wrapper });
    await vi.waitFor(() => expect(next.result.current.status).toBe('ready'));

    expect(created).toHaveLength(IMAGE_BLOB_CACHE_SIZE + 2);
    expect(revoked.length).toBeGreaterThan(0);
    expect(revoked).not.toContain(next.result.current.url);
  });

  it('取图失败时返回错误码', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    spyOnObjectUrls(created, revoked);
    const fake = createFakeApi({
      'image.file': () => {
        throw new ORPCError('image_file_missing');
      },
    });
    const wrapper = wrapperFor(fake.api);
    const illustrationId = crypto.randomUUID();
    const hook = await renderHook(() => useImageBlob(illustrationInput(illustrationId), 1), { wrapper });

    await vi.waitFor(() => {
      expect(hook.result.current).toEqual({ status: 'error', url: null, code: 'image_file_missing' });
    });
    expect(created).toEqual([]);
  });
});
