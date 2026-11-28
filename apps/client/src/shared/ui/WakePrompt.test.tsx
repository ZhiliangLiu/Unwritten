import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ImageConfigView, ImageServiceView } from '@unwritten/contracts';
import { render } from 'vitest-browser-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api/context.tsx';
import { queryKeys } from '../api/query.ts';
import { createFakeApi } from '../test/fake-api.ts';
import { expectNoAxeViolations } from '../test/axe.ts';
import { initTestI18n } from '../test/i18n.ts';
import { WakePrompt } from './WakePrompt.tsx';

initTestI18n();

const serviceId = 'image-local-0a1b2c';
const actionUrl = 'https://example.com/authorize';
const needsActionText = '出图服务需要你在浏览器里完成授权。';

function service(overrides: Partial<ImageServiceView> = {}): ImageServiceView {
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
    state: 'ready',
    action: null,
    wakeFailure: null,
    ...overrides,
  };
}

function config(overrides: Partial<ImageServiceView>): ImageConfigView {
  return {
    status: 'ok',
    revision: 'revision-1',
    problem: null,
    services: [service(overrides)],
    selectedServiceId: serviceId,
  };
}

async function renderPrompt(initial: Partial<ImageServiceView> = {}) {
  let current = initial;
  const continued: unknown[] = [];
  const fake = createFakeApi({
    'image.services.list': () => config(current),
    'image.wake.continue': (input) => {
      continued.push(input);
      return {};
    },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <ApiProvider value={fake.api}>
      <QueryClientProvider client={queryClient}>
        <WakePrompt serviceId={serviceId} />
      </QueryClientProvider>
    </ApiProvider>,
  );
  const update = async (next: Partial<ImageServiceView>) => {
    current = next;
    await queryClient.refetchQueries({ queryKey: queryKeys.imageConfig });
  };
  return { screen, fake, continued, queryClient, update };
}

describe('WakePrompt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('等待授权时显示两个按钮，继续会带上服务 id', async () => {
    const { screen, continued } = await renderPrompt({
      state: 'needs_action',
      action: { url: actionUrl, expiresAt: 1 },
    });

    await expect.element(screen.getByRole('button', { name: '打开授权页' })).toBeVisible();
    await screen.getByRole('button', { name: '继续' }).click();

    await vi.waitFor(() => expect(continued).toHaveLength(1));
    expect(continued[0]).toMatchObject({ serviceId });
  });

  it('打开授权页用系统浏览器的新窗口', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { screen } = await renderPrompt({
      state: 'needs_action',
      action: { url: actionUrl, expiresAt: 1 },
    });

    await screen.getByRole('button', { name: '打开授权页' }).click();

    expect(open).toHaveBeenCalledWith(actionUrl, '_blank', 'noopener,noreferrer');
  });

  it('新的授权地址会再次播报同一句提示', async () => {
    const { screen, update } = await renderPrompt({
      state: 'needs_action',
      action: { url: actionUrl, expiresAt: 1 },
    });
    await expect.element(screen.getByRole('button', { name: '继续' })).toBeVisible();

    const live = screen.container.querySelector('[aria-live="polite"]');
    if (!(live instanceof HTMLElement)) throw new Error('live region missing');
    await vi.waitFor(() => expect(live.textContent).toBe(needsActionText));

    let announcements = 0;
    const observer = new MutationObserver(() => {
      if (live.textContent === needsActionText) announcements += 1;
    });
    observer.observe(live, { childList: true, characterData: true, subtree: true });

    await update({
      state: 'needs_action',
      action: { url: `${actionUrl}/second`, expiresAt: 2 },
    });

    await vi.waitFor(() => expect(announcements).toBeGreaterThan(0));
    observer.disconnect();
  });

  it('服务就绪时不渲染', async () => {
    const { screen, fake, queryClient } = await renderPrompt({ state: 'ready' });

    await vi.waitFor(() => expect(fake.calls.some((call) => call.path === 'image.services.list')).toBe(true));
    await vi.waitFor(() => expect(queryClient.getQueryState(queryKeys.imageConfig)?.status).toBe('success'));
    expect(screen.container.querySelectorAll('button')).toHaveLength(0);
  });

  it('无可访问性违规', async () => {
    const { screen } = await renderPrompt({
      state: 'needs_action',
      action: { url: actionUrl, expiresAt: 1 },
    });

    await expect.element(screen.getByRole('button', { name: '继续' })).toBeVisible();
    await expectNoAxeViolations(screen.container);
  });
});
