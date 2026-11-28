import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ORPCError } from '@orpc/client';
import type { IllustrationView, ImageConfigView, ImageServiceState, ImageServiceView } from '@unwritten/contracts';
import { cleanup, render } from 'vitest-browser-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../shared/api/context.tsx';
import { resetImageBlobCacheForTests } from '../../shared/hooks/useImageBlob.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import type { FakeApi, FakeApiCall } from '../../shared/test/fake-api.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { IllustrationFrame } from './IllustrationFrame.tsx';

initTestI18n();

const routeId = '2f1d5c4a-8b7e-4a3f-9c2d-1e0f9a8b7c6d';
const serviceId = 'image-local-0a1b2c';
const paraAnchorId = 'turn-frame-test-para-1';

function illustration(overrides: Partial<IllustrationView> = {}): IllustrationView {
  return {
    id: crypto.randomUUID(),
    updatedAt: 1,
    status: 'queued',
    rerolling: false,
    para: 1,
    format: { aspectPreference: '3:2', resolutionTier: '1k', size: null },
    image: null,
    caption: null,
    error: null,
    stage: null,
    serviceId,
    ...overrides,
  };
}

function service(state: ImageServiceState): ImageServiceView {
  return {
    id: serviceId,
    name: '测试出图服务',
    protocol: 'unwritten-image',
    baseUrl: 'http://127.0.0.1:8000',
    key: { hasKey: false, source: 'none', envVar: null },
    model: null,
    openai: null,
    launcher: null,
    idleMinutes: 30,
    capabilities: null,
    probe: null,
    lastSuccessAt: null,
    state,
    action: null,
    wakeFailure: null,
  };
}

function config(state: ImageServiceState): ImageConfigView {
  return {
    status: 'ok',
    revision: 'revision-1',
    problem: null,
    services: [service(state)],
    selectedServiceId: serviceId,
  };
}

async function pngBlob(width = 4, height = 3): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')?.fillRect(0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/png' });
}

interface FrameOptions {
  state?: ImageServiceState;
  file?: () => Blob | Promise<Blob>;
  extraHandlers?: Record<string, (input: unknown) => unknown>;
}

async function renderFrame(view: IllustrationView, options: FrameOptions = {}) {
  const fake = createFakeApi({
    'image.services.list': () => config(options.state ?? 'ready'),
    'image.file': () => (options.file ? options.file() : pngBlob()),
    'log.client': () => undefined,
    'illustration.retry': () => view,
    'illustration.reroll': () => view,
    'illustration.dismiss': () => view,
    'image.outputPreferences.get': () => ({
      preferences: { aspectPreference: 'auto', resolutionTier: '1k' },
      aspects: ['1:1', '3:2'],
      tiers: [
        { tier: '1k', sizes: { '3:2': { width: 1536, height: 1024 } } },
        { tier: '2k', sizes: { '3:2': { width: 2048, height: 1365 } } },
      ],
      preferenceAvailable: true,
    }),
    ...options.extraHandlers,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (next: IllustrationView) => (
    <ApiProvider value={fake.api}>
      <QueryClientProvider client={queryClient}>
        <p id={paraAnchorId} tabIndex={-1}>
          所属段落
        </p>
        <IllustrationFrame illustration={next} routeId={routeId} paraAnchorId={paraAnchorId} depth={2} />
      </QueryClientProvider>
    </ApiProvider>
  );
  const screen = await render(ui(view));
  return { screen, fake, rerender: (next: IllustrationView) => screen.rerender(ui(next)) };
}

function sampleCalls(fake: FakeApi): FakeApiCall[] {
  return fake.calls.filter(
    (call) =>
      call.path === 'log.client' && (call.input as { metric?: string }).metric === 'client.illustration_visible',
  );
}

describe('IllustrationFrame', () => {
  afterEach(async () => {
    await cleanup();
    resetImageBlobCacheForTests();
    vi.restoreAllMocks();
  });

  it('排队且服务正在唤醒时，画框里显示唤醒状态', async () => {
    const { screen } = await renderFrame(illustration(), { state: 'waking' });

    await expect.element(screen.getByText('正在唤醒出图服务')).toBeVisible();
    expect(screen.container.querySelector('[data-uw-illustration-frame]')?.getAttribute('aria-busy')).toBe('true');
  });

  it('比例未定时，唤醒状态也只显示一行状态文字', async () => {
    const { screen } = await renderFrame(illustration({ format: null }), { state: 'waking' });

    await expect.element(screen.getByText('正在唤醒出图服务')).toBeVisible();
    expect(screen.container.querySelector('[data-uw-illustration-frame]')).toBeNull();
  });

  it('画好后是一个放大查看的按钮，alt 是画面说明', async () => {
    const view = illustration({
      status: 'done',
      image: { width: 4, height: 3 },
      caption: '雾里有人提着一盏灯。',
    });
    const { screen } = await renderFrame(view);

    await expect.element(screen.getByRole('button', { name: '放大查看插图' })).toBeVisible();
    await expect.element(screen.getByRole('img', { name: '雾里有人提着一盏灯。' })).toBeVisible();
    const image = screen.getByRole('img', { name: '雾里有人提着一盏灯。' }).element() as HTMLImageElement;
    expect(image.alt).toBe('雾里有人提着一盏灯。');
  });

  it('取图返回 image_file_missing 时显示找不到和重画', async () => {
    const view = illustration({ status: 'done', image: { width: 4, height: 3 }, caption: '雾里有人提着一盏灯。' });
    const { screen, fake } = await renderFrame(view, {
      file: () => {
        throw new ORPCError('image_file_missing');
      },
    });

    await expect.element(screen.getByText('图片找不到了')).toBeVisible();
    await screen.getByRole('button', { name: '重画' }).click();

    await vi.waitFor(() => expect(fake.calls.some((call) => call.path === 'illustration.reroll')).toBe(true));
    expect(fake.calls.find((call) => call.path === 'illustration.reroll')?.input).toMatchObject({
      illustrationId: view.id,
    });
  });

  it('取图因其他错误失败时用普通一行原因，不触发 alert', async () => {
    const view = illustration({ status: 'done', image: { width: 4, height: 3 }, caption: '雾里有人提着一盏灯。' });
    const { screen } = await renderFrame(view, {
      file: () => {
        throw new ORPCError('image_server');
      },
    });

    await expect.element(screen.getByText('出图服务发生错误。请稍后重试。')).toBeVisible();
    expect(screen.container.querySelector('[role="alert"]')).toBeNull();
    await expect.element(screen.getByRole('button', { name: '重画' })).toBeVisible();
  });

  it('重试被拒绝时显示对应错误', async () => {
    const view = illustration({ status: 'failed', error: 'image_server', stage: 'generate' });
    const { screen } = await renderFrame(view, {
      extraHandlers: {
        'illustration.retry': () => {
          throw new ORPCError('image_rate_limited');
        },
      },
    });

    await screen.getByRole('group', { name: '第 2 回合的插图' }).getByRole('button', { name: '重试' }).click();
    await expect.element(screen.getByText('出图请求太多。请稍后重试。')).toBeVisible();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('不要这张图被拒绝时显示对应错误', async () => {
    const view = illustration({ status: 'failed', error: 'image_server', stage: 'generate' });
    const { screen } = await renderFrame(view, {
      extraHandlers: {
        'illustration.dismiss': () => {
          throw new ORPCError('image_offline');
        },
      },
    });

    await screen.getByRole('group', { name: '第 2 回合的插图' }).getByRole('button', { name: '不要这张图' }).click();
    await expect.element(screen.getByText('连不上出图服务。服务恢复后可以重试。')).toBeVisible();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('画失败时显示阶段和原因，重试名称里有回合号', async () => {
    const view = illustration({ status: 'failed', error: 'image_server', stage: 'generate' });
    const { screen, fake } = await renderFrame(view);

    await expect.element(screen.getByText('生成图片时，出图服务发生错误。请稍后重试。')).toBeVisible();
    await screen.getByRole('group', { name: '第 2 回合的插图' }).getByRole('button', { name: '重试' }).click();

    await vi.waitFor(() => expect(fake.calls.some((call) => call.path === 'illustration.retry')).toBe(true));
    expect(fake.calls.find((call) => call.path === 'illustration.retry')?.input).toMatchObject({
      illustrationId: view.id,
      format: null,
    });
  });

  it('规格不可用时先选规格，确认后重试带上 format', async () => {
    const view = illustration({ status: 'failed', error: 'image_output_format_unavailable', stage: 'generate' });
    const { screen, fake } = await renderFrame(view);

    await screen.getByRole('group', { name: '第 2 回合的插图' }).getByRole('button', { name: '重试' }).click();
    await expect.element(screen.getByRole('dialog', { name: '为这张图选择规格' })).toBeVisible();

    await screen.getByRole('combobox', { name: '画面比例' }).click();
    await screen.getByRole('option', { name: '3:2' }).click();
    await screen.getByRole('combobox', { name: '分辨率' }).click();
    await screen.getByRole('option', { name: '非常高 · 2K' }).click();
    await screen.getByRole('button', { name: '重试' }).click();

    await vi.waitFor(() => expect(fake.calls.some((call) => call.path === 'illustration.retry')).toBe(true));
    expect(fake.calls.find((call) => call.path === 'illustration.retry')?.input).toMatchObject({
      illustrationId: view.id,
      format: { aspectPreference: '3:2', resolutionTier: '2k' },
    });
  });

  it('自动比例未定时只有一行正在构思画面，没有画框', async () => {
    const { screen } = await renderFrame(illustration({ format: null }));

    await expect.element(screen.getByText('正在构思画面')).toBeVisible();
    expect(screen.container.querySelector('[data-uw-illustration-frame]')).toBeNull();
  });

  it('同一个插图解码两次也只上报一次 client.illustration_visible', async () => {
    const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
    const view = illustration({ status: 'done', image: { width: 4, height: 3 }, caption: '雾里有人提着一盏灯。' });
    const { rerender, fake, screen } = await renderFrame(view);

    await expect.element(screen.getByRole('button', { name: '放大查看插图' })).toBeVisible();
    await vi.waitFor(() => expect(sampleCalls(fake)).toHaveLength(1));
    expect(sampleCalls(fake)[0]?.input).toMatchObject({
      outcome: 'ok',
      requestId: view.id,
    });

    const decodedBefore = decode.mock.calls.length;
    expect(decodedBefore).toBeGreaterThan(0);
    await rerender({ ...view, updatedAt: 2 });
    await vi.waitFor(() => expect(decode.mock.calls.length).toBeGreaterThan(decodedBefore));
    await vi.waitFor(() => expect(sampleCalls(fake)).toHaveLength(1));
  });

  it('无可访问性违规（排队）', async () => {
    const { screen } = await renderFrame(illustration(), { state: 'waking' });
    await expect.element(screen.getByText('正在唤醒出图服务')).toBeVisible();
    await expectNoAxeViolations(screen.container);
  });

  it('无可访问性违规（画好）', async () => {
    const view = illustration({ status: 'done', image: { width: 4, height: 3 }, caption: '雾里有人提着一盏灯。' });
    const { screen } = await renderFrame(view);
    await expect.element(screen.getByRole('button', { name: '放大查看插图' })).toBeVisible();
    await expectNoAxeViolations(screen.container);
  });

  it('无可访问性违规（失败）', async () => {
    const view = illustration({ status: 'failed', error: 'image_server', stage: 'generate' });
    const { screen } = await renderFrame(view);
    await expect.element(screen.getByText('生成图片时，出图服务发生错误。请稍后重试。')).toBeVisible();
    await expectNoAxeViolations(screen.container);
  });
});
