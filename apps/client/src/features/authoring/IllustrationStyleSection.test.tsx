import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_WORK_SETTINGS, EMPTY_WORK_ANCHORS } from '@unwritten/contracts';
import type { ImageConfigView, WorkDetail } from '@unwritten/contracts';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { IllustrationStyleSection } from './IllustrationStyleSection.tsx';

initTestI18n();

const work: WorkDetail = {
  id: 'work-1',
  title: null,
  blurb: null,
  status: 'draft',
  hasUnpublishedChanges: false,
  routeCount: 0,
  draft: {
    contentRev: 1,
    background: '海边小镇的灯塔。',
    anchors: EMPTY_WORK_ANCHORS,
    settings: DEFAULT_WORK_SETTINGS,
    wizardStep: 'background',
    plan: null,
  },
  latestPreviewJob: null,
  latestPlanJob: null,
  illustrationStyle: null,
};

function config(withService: boolean): ImageConfigView {
  return {
    status: 'ok',
    revision: 'revision-1',
    problem: null,
    services: withService
      ? [
          {
            id: 'image-local-0a1b2c',
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
          },
        ]
      : [],
    selectedServiceId: withService ? 'image-local-0a1b2c' : null,
  };
}

async function setup(withService: boolean) {
  const updates: unknown[] = [];
  const fake = createFakeApi({
    'image.services.list': () => config(withService),
    'works.setIllustrationStyle': (input) => {
      updates.push(input);
      return {};
    },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <ApiProvider value={fake.api}>
      <QueryClientProvider client={queryClient}>
        <IllustrationStyleSection work={work} />
      </QueryClientProvider>
    </ApiProvider>,
  );
  return { screen, fake, updates, queryClient };
}

describe('IllustrationStyleSection', () => {
  it('没有出图服务时这一节不渲染', async () => {
    const { screen, fake, queryClient } = await setup(false);
    await vi.waitFor(() => expect(fake.calls.some((call) => call.path === 'image.services.list')).toBe(true));
    await vi.waitFor(() => expect(queryClient.getQueryState(queryKeys.imageConfig)?.status).toBe('success'));
    expect(screen.getByText('插图').query()).toBeNull();
    await screen.unmount();
  });

  it('选画风直接保存，不走草稿', async () => {
    const { screen, fake, updates, queryClient } = await setup(true);
    await vi.waitFor(() => expect(queryClient.getQueryState(queryKeys.imageConfig)?.status).toBe('success'));
    await expect.element(screen.getByRole('heading', { name: '插图' })).toBeVisible();
    await screen.getByText('水彩').click();
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toEqual({ workId: work.id, style: { kind: 'preset', preset: 'watercolor' } });
    expect(fake.calls.some((call) => call.path === 'works.saveDraft')).toBe(false);
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const { screen, queryClient } = await setup(true);
    await vi.waitFor(() => expect(queryClient.getQueryState(queryKeys.imageConfig)?.status).toBe('success'));
    await expect.element(screen.getByRole('heading', { name: '插图' })).toBeVisible();
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
