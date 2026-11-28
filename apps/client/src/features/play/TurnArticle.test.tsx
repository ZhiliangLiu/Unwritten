import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { IllustrationView, ImageConfigView, ImageServiceView, TurnView } from '@unwritten/contracts';
import { cleanup, render } from 'vitest-browser-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../shared/api/context.tsx';
import { resetImageBlobCacheForTests } from '../../shared/hooks/useImageBlob.ts';
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
    status: 'queued',
    rerolling: false,
    para: 2,
    format: { aspectPreference: '3:2', resolutionTier: '1k', size: null },
    image: null,
    caption: null,
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
    action: null,
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

async function renderArticle(article: TurnView) {
  const fake = createFakeApi({
    'image.services.list': () => config(),
    'log.client': () => undefined,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (next: TurnView) => (
    <ApiProvider value={fake.api}>
      <QueryClientProvider client={queryClient}>
        <TurnArticle turn={next} language='zh-CN' arriving={false} routeId={routeId} />
      </QueryClientProvider>
    </ApiProvider>
  );
  const screen = await render(ui(article));
  return { screen, fake, rerender: (next: TurnView) => screen.rerender(ui(next)) };
}

describe('TurnArticle 插图位置', () => {
  afterEach(async () => {
    await cleanup();
    resetImageBlobCacheForTests();
    document.documentElement.style.removeProperty('overflow-anchor');
    document.body.style.removeProperty('overflow-anchor');
    document.body.style.removeProperty('inline-size');
    window.scrollTo(0, 0);
  });

  it('段号 2 的插图在第 2 段之后、第 3 段之前', async () => {
    const article = turn(illustration({ para: 2 }));
    const { screen } = await renderArticle(article);

    await expect.element(screen.getByText('插图在排队')).toBeVisible();
    const second = document.getElementById(paragraphAnchorId(article.id, 2));
    const frame = screen.container.querySelector('[data-uw-illustration-frame]');
    const third = document.getElementById(paragraphAnchorId(article.id, 3));
    expect(second).not.toBeNull();
    expect(frame).not.toBeNull();
    expect(third).not.toBeNull();
    expect(second!.compareDocumentPosition(frame!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(frame!.compareDocumentPosition(third!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('状态是 dismissed 时不渲染插图', async () => {
    const article = turn(illustration({ status: 'dismissed' }));
    const { screen } = await renderArticle(article);

    await expect.element(screen.getByText('雾还没散。')).toBeVisible();
    expect(screen.container.querySelector('[data-uw-illustration-frame]')).toBeNull();
    expect(screen.container.textContent).not.toContain('插图在排队');
  });

  it('图片展开时，正在读的段落停在原处', async () => {
    document.documentElement.style.setProperty('overflow-anchor', 'none');
    document.body.style.setProperty('overflow-anchor', 'none');
    document.body.style.setProperty('inline-size', '24rem');
    const paragraphText = '雾从河面升起来，沿着石阶一级一级往上爬，把候船厅的窗子擦成一片灰白。'.repeat(5);
    const article = {
      ...turn(illustration({ para: 2, format: null })),
      paragraphs: Array.from({ length: 12 }, (_, index) => `${paragraphText}${index}`),
    };
    const { screen, rerender } = await renderArticle(article);
    await expect.element(screen.getByText('正在构思画面')).toBeVisible();

    const target = document.getElementById(paragraphAnchorId(article.id, 7));
    expect(target).not.toBeNull();
    window.scrollBy(0, target!.getBoundingClientRect().top - 80);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const before = target!.getBoundingClientRect().top;
    expect(before).toBeGreaterThan(0);
    expect(window.scrollY).toBeGreaterThan(0);

    await rerender({
      ...article,
      illustration: illustration({
        para: 2,
        format: { aspectPreference: '3:2', resolutionTier: '1k', size: null },
      }),
    });

    await vi.waitFor(() => {
      expect(Math.abs(target!.getBoundingClientRect().top - before)).toBeLessThanOrEqual(1);
    });
    expect(screen.container.querySelector('[data-uw-illustration-frame]')).not.toBeNull();
  });
});
