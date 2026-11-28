import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ORPCError } from '@orpc/client';
import type { IllustrationView, ImageConfigView, ImageServiceView, TurnView } from '@unwritten/contracts';
import { cleanup, render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../shared/api/context.tsx';
import { resetImageBlobCacheForTests } from '../../shared/hooks/useImageBlob.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { TurnArticle } from './TurnArticle.tsx';
import { paragraphAnchorId } from './anchors.ts';

initTestI18n();

const routeId = '2f1d5c4a-8b7e-4a3f-9c2d-1e0f9a8b7c6d';
const serviceId = 'image-local-0a1b2c';

function illustration(overrides: Partial<IllustrationView> = {}): IllustrationView {
  return {
    id: crypto.randomUUID(),
    updatedAt: 1,
    status: 'done',
    rerolling: false,
    para: 2,
    format: { aspectPreference: '3:2', resolutionTier: '1k', size: { width: 1536, height: 1024 } },
    image: { width: 4, height: 3 },
    caption: '雾里有人提着一盏灯。',
    error: null,
    stage: null,
    serviceId,
    ...overrides,
  };
}

function turn(view: IllustrationView): TurnView {
  return {
    id: crypto.randomUUID(),
    originRequest: null,
    depth: 1,
    action: { text: '把灯放在门槛上', optionIndex: 1 },
    paragraphs: ['雾还没散。', '守夜人侧过身。', '灯芯轻轻响了一声。'],
    options: [],
    illustration: view,
    createdAt: 1,
  };
}

function service(): ImageServiceView {
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
    capabilitiesAt: null,
    state: 'ready',
    action: null,
    wakeFailure: null,
  };
}

function config(): ImageConfigView {
  return {
    status: 'ok',
    revision: 'revision-1',
    problem: null,
    services: [service()],
    selectedServiceId: serviceId,
  };
}

async function pngBlob(): Promise<Blob> {
  const canvas = new OffscreenCanvas(4, 3);
  canvas.getContext('2d')?.fillRect(0, 0, 4, 3);
  return canvas.convertToBlob({ type: 'image/png' });
}

async function renderArticle(
  view: IllustrationView,
  depth = 1,
  options: { file?: () => Blob | Promise<Blob>; handlers?: Record<string, (input: unknown) => unknown> } = {},
) {
  const base = { ...turn(view), depth };
  const dismissed: unknown[] = [];
  const fake = createFakeApi({
    'image.services.list': () => config(),
    'image.file': () => (options.file ? options.file() : pngBlob()),
    'log.client': () => undefined,
    'illustration.dismiss': (input) => {
      dismissed.push(input);
      return view;
    },
    'illustration.reroll': () => view,
    'illustration.retry': () => view,
    ...options.handlers,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (next: IllustrationView) => (
    <ApiProvider value={fake.api}>
      <QueryClientProvider client={queryClient}>
        <TurnArticle turn={{ ...base, illustration: next }} language='zh-CN' arriving={false} routeId={routeId} />
      </QueryClientProvider>
    </ApiProvider>
  );
  const screen = await render(ui(view));
  return { screen, article: base, fake, dismissed, rerender: (next: IllustrationView) => screen.rerender(ui(next)) };
}

async function openLightbox(screen: Awaited<ReturnType<typeof renderArticle>>['screen']) {
  await expect.element(screen.getByRole('button', { name: '放大查看插图' })).toBeVisible();
  await expect.element(screen.getByRole('img', { name: '雾里有人提着一盏灯。' })).toBeVisible();
  const button = screen.getByRole('button', { name: '放大查看插图' }).element();
  await screen.getByRole('button', { name: '放大查看插图' }).click();
  await expect.element(screen.getByRole('dialog', { name: '插图' })).toBeVisible();
  return button;
}

describe('IllustrationLightbox', () => {
  afterEach(async () => {
    await cleanup();
    resetImageBlobCacheForTests();
    vi.restoreAllMocks();
  });

  it('大图的描述是画面说明', async () => {
    const { screen } = await renderArticle(illustration());
    await openLightbox(screen);

    const dialog = screen.getByRole('dialog', { name: '插图' }).element();
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('雾里有人提着一盏灯。');
    await expect.element(screen.getByText('4 × 3 像素')).toBeVisible();
  });

  it('Esc 关闭后焦点回到插图按钮', async () => {
    const { screen } = await renderArticle(illustration());
    const button = await openLightbox(screen);

    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('不要这张图后焦点落在所属段落', async () => {
    const { screen, article, dismissed } = await renderArticle(illustration({ para: 2 }));
    await openLightbox(screen);

    await screen.getByRole('button', { name: '不要这张图' }).click();

    await vi.waitFor(() => expect(dismissed).toHaveLength(1));
    expect(dismissed[0]).toMatchObject({ illustrationId: article.illustration?.id });
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    const target = document.getElementById(paragraphAnchorId(article.id, 2));
    await vi.waitFor(() => expect(document.activeElement).toBe(target));
  });

  it('移除开场图后焦点落在第一段', async () => {
    const { screen, article } = await renderArticle(illustration({ para: 0 }), 0);
    await openLightbox(screen);

    await screen.getByRole('button', { name: '不要这张图' }).click();

    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    const target = document.getElementById(paragraphAnchorId(article.id, 1));
    await vi.waitFor(() => expect(document.activeElement).toBe(target));
  });

  it('重画期间保持旧图并显示正在重画', async () => {
    const { screen, fake } = await renderArticle(illustration({ rerolling: true }));
    await openLightbox(screen);

    await expect.element(screen.getByRole('button', { name: '正在重画' })).toBeVisible();
    expect(screen.getByRole('img', { name: '雾里有人提着一盏灯。' }).element()).toBeTruthy();
    expect(fake.calls.some((call) => call.path === 'illustration.reroll')).toBe(false);
  });

  it('重画开始后保持旧图和打开的大图，完成后才换新图', async () => {
    const view = illustration();
    let fileCalls = 0;
    const pending = Promise.withResolvers<Blob>();
    const { screen, rerender } = await renderArticle(view, 1, {
      file: () => {
        fileCalls += 1;
        return fileCalls === 2 ? pending.promise : pngBlob();
      },
    });
    await openLightbox(screen);
    const dialogImage = () =>
      screen.getByRole('dialog', { name: '插图' }).element().querySelector('img') as HTMLImageElement;
    const inlineImage = () => screen.container.querySelector<HTMLImageElement>('article button img');
    const oldSrc = dialogImage().src;
    expect(oldSrc.startsWith('blob:')).toBe(true);
    expect(inlineImage()?.src).toBe(oldSrc);

    await screen.getByRole('button', { name: '重画' }).click();
    await rerender({ ...view, rerolling: true, updatedAt: 2 });
    await vi.waitFor(() => expect(fileCalls).toBeGreaterThanOrEqual(2));

    await expect.element(screen.getByRole('button', { name: '正在重画' })).toBeVisible();
    await expect.element(screen.getByRole('dialog', { name: '插图' })).toBeVisible();
    expect(dialogImage().src).toBe(oldSrc);
    expect(inlineImage()?.src).toBe(oldSrc);

    await rerender({
      ...view,
      rerolling: false,
      updatedAt: 3,
      image: { width: 5, height: 4 },
      caption: '雾散了。',
    });

    await vi.waitFor(() => {
      expect(dialogImage().src).not.toBe(oldSrc);
      expect(dialogImage().alt).toBe('雾散了。');
    });
    await expect.element(screen.getByRole('dialog', { name: '插图' })).toBeVisible();
  });

  it('保存图片用插图的下载名', async () => {
    const { screen } = await renderArticle(illustration());
    await openLightbox(screen);

    const link = screen.getByRole('link', { name: '保存图片' }).element() as HTMLAnchorElement;
    expect(link.download).toBe('illustration-1.png');
    expect(link.href.startsWith('blob:')).toBe(true);
  });

  it('重画或不要这张图被拒绝时显示对应错误', async () => {
    const { screen } = await renderArticle(illustration(), 1, {
      handlers: {
        'illustration.reroll': () => {
          throw new ORPCError('image_busy');
        },
        'illustration.dismiss': () => {
          throw new ORPCError('image_not_ready');
        },
      },
    });
    await openLightbox(screen);

    await screen.getByRole('button', { name: '重画' }).click();
    await expect.element(screen.getByText('出图服务的队列已满。请稍后重试。')).toBeVisible();
    await screen.getByRole('button', { name: '不要这张图' }).click();
    await expect.element(screen.getByText('出图服务还在准备。请稍后重试。')).toBeVisible();
    await expect.element(screen.getByRole('dialog', { name: '插图' })).toBeVisible();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('打开大图后无可访问性违规', async () => {
    const { screen } = await renderArticle(illustration());
    await openLightbox(screen);

    await expectNoAxeViolations(document.body);
  });
});
