import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORK_SETTINGS, EMPTY_WORK_ANCHORS } from '@unwritten/contracts';
import type { PlanJobView, WorkDetail } from '@unwritten/contracts';
import { queryKeys } from '../../shared/api/query.ts';
import { ApiProvider } from '../../shared/api/context.tsx';
import type { ApiClient } from '../../shared/api/client.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import type { FakeApiCall } from '../../shared/test/fake-api.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { BackgroundEditor } from './BackgroundEditor.tsx';
import type { DraftContent } from './draft.ts';

initTestI18n();

function workDetail(overrides: Partial<WorkDetail> = {}): WorkDetail {
  return {
    id: crypto.randomUUID(),
    title: null,
    blurb: null,
    status: 'draft',
    hasUnpublishedChanges: false,
    routeCount: 0,
    draft: {
      contentRev: 3,
      background: '最后一班渡轮停开了。',
      anchors: EMPTY_WORK_ANCHORS,
      settings: DEFAULT_WORK_SETTINGS,
      wizardStep: 'background',
      plan: null,
    },
    latestPreviewJob: null,
    latestPlanJob: null,
    illustrationStyle: null,
    ...overrides,
  };
}

function draftOf(work: WorkDetail): DraftContent {
  return { background: work.draft.background, anchors: work.draft.anchors, settings: work.draft.settings };
}

function providers(api: ApiClient, queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ApiProvider value={api}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiProvider>
    );
  };
}

function callsTo(calls: FakeApiCall[], path: string): FakeApiCall[] {
  return calls.filter((call) => call.path === path);
}

function planJob(status: PlanJobView['status']): PlanJobView {
  return {
    id: crypto.randomUUID(),
    status,
    basedOnContentRev: 3,
    error: null,
    stale: false,
    updatedAt: Date.now(),
  };
}

describe('BackgroundEditor', () => {
  it('保存时带上补充设定', async () => {
    const work = workDetail({
      draft: {
        ...workDetail().draft,
        settings: { ...DEFAULT_WORK_SETTINGS, cast: { text: '', mode: 'per_run' } },
      },
    });
    const { api, calls } = createFakeApi({
      'works.saveDraft': () => ({ contentRev: 4 }),
      'log.client': () => ({}),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.work(work.id), work);
    const Wrapper = providers(api, queryClient);

    function Harness() {
      const [draft, setDraft] = useState(draftOf(work));
      return (
        <BackgroundEditor
          work={work}
          draft={draft}
          savedDraft={draftOf(work)}
          onDraftChange={setDraft}
          onGeneratePlan={() => {}}
          generating={false}
          planJob={null}
        />
      );
    }

    const screen = await render(
      <Wrapper>
        <Harness />
      </Wrapper>,
    );
    await screen.getByRole('textbox', { name: '故事背景' }).fill('最后一班渡轮停开了。夜里的潮声。');
    await vi.waitFor(
      () => {
        expect(callsTo(calls, 'works.saveDraft')).toHaveLength(1);
      },
      { timeout: 3_000 },
    );
    expect(callsTo(calls, 'works.saveDraft')[0]?.input).toMatchObject({
      settings: { cast: { mode: 'per_run' } },
    });
    await screen.unmount();
  });

  it('方案生成结果出现后上报一次 client.plan_visible', async () => {
    const work = workDetail();
    const { api, calls } = createFakeApi({
      'works.saveDraft': () => ({ contentRev: 4 }),
      'log.client': () => ({}),
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.work(work.id), work);
    const Wrapper = providers(api, queryClient);
    const onGeneratePlan = vi.fn();
    const view = (job: PlanJobView | null, generating: boolean) => (
      <Wrapper>
        <BackgroundEditor
          work={work}
          draft={draftOf(work)}
          savedDraft={draftOf(work)}
          onDraftChange={() => {}}
          onGeneratePlan={onGeneratePlan}
          generating={generating}
          planJob={job}
        />
      </Wrapper>
    );

    const screen = await render(view(null, false));
    await screen.getByRole('button', { name: '生成故事方案' }).click();
    await vi.waitFor(() => {
      expect(onGeneratePlan).toHaveBeenCalledWith(3);
    });
    const running = planJob('running');
    await screen.rerender(view(running, true));
    const done = { ...running, status: 'done' as const };
    await screen.rerender(view(done, false));
    await screen.getByRole('button', { name: '生成故事方案' }).click();
    await screen.rerender(view({ ...done }, false));
    await vi.waitFor(() => {
      expect(callsTo(calls, 'log.client')).toHaveLength(1);
    });
    expect(callsTo(calls, 'log.client')[0]?.input).toMatchObject({
      metric: 'client.plan_visible',
      outcome: 'ok',
      workId: work.id,
      jobId: done.id,
    });
    await screen.unmount();
  });
});
