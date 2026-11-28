import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORK_SETTINGS, EMPTY_WORK_ANCHORS } from '@unwritten/contracts';
import type { PlanJobView, PlanView, Preview, PreviewJobView, WorkAnchors, WorkDetail } from '@unwritten/contracts';
import { queryKeys } from '../../shared/api/query.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import type { FakeApiCall } from '../../shared/test/fake-api.ts';
import { renderRoute } from '../../shared/test/render.tsx';
import { expectHeadingOutline } from '../../shared/test/heading-outline.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { AUTOSAVE_DELAY_MS } from './BackgroundEditor.tsx';

function preview(overrides: Partial<Preview> = {}): Preview {
  return {
    title: '末班渡轮',
    blurb: '最后一班船已经开走，候船厅里还有一个人在等。',
    publicSetting: '深夜的渡口，只剩售票窗口亮着灯。',
    prose: '最后一班渡轮的汽笛远了。\n\n长椅上的人提着一只空鸟笼。',
    options: [
      { text: '问他在等谁', hint: null },
      { text: '告诉他今天没有船了', hint: null },
    ],
    scene: { place: '候船厅', time: '深夜' },
    language: 'zh-CN',
    cast: [],
    needsReview: [],
    initialState: [],
    ...overrides,
  };
}

function plan(overrides: Partial<PlanView> = {}): PlanView {
  return {
    confirmed: false,
    conflicts: [],
    items: [
      {
        id: 'item-summary',
        source: 'ai',
        kind: 'summary',
        key: 'identity',
        text: '刚到灯塔镇的邮差。',
      },
    ],
    ...overrides,
  };
}

function planJob(overrides: Partial<PlanJobView> = {}): PlanJobView {
  return {
    id: crypto.randomUUID(),
    status: 'done',
    basedOnContentRev: 3,
    error: null,
    stale: false,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function job(overrides: Partial<PreviewJobView> = {}): PreviewJobView {
  return {
    id: crypto.randomUUID(),
    status: 'done',
    basedOnContentRev: 3,
    error: null,
    preview: preview(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

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
      background: '原来的背景。',
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

function makeApi(initial: WorkDetail, handlers: Record<string, (input: unknown) => unknown> = {}) {
  const state = { detail: initial, confirmRevs: [] as number[] };
  const fake = createFakeApi({
    'works.get': () => state.detail,
    'works.list': () => [],
    'works.setWizardStep': (input) => {
      const { step } = input as { step: WorkDetail['draft']['wizardStep'] };
      state.detail = { ...state.detail, draft: { ...state.detail.draft, wizardStep: step } };
      return {};
    },
    'works.saveDraft': (input) => {
      const { baseContentRev, background, anchors, settings } = input as {
        baseContentRev: number;
        background: string;
        anchors: WorkAnchors;
        settings?: WorkDetail['draft']['settings'];
      };
      const contentRev = baseContentRev + 1;
      state.detail = {
        ...state.detail,
        draft: {
          ...state.detail.draft,
          contentRev,
          background,
          anchors,
          settings: settings ?? state.detail.draft.settings,
        },
      };
      return { contentRev };
    },
    'works.generatePlan': (input) => {
      const { jobId, contentRev } = input as { jobId: string; contentRev: number };
      const generated = planJob({ id: jobId, basedOnContentRev: contentRev });
      state.detail = {
        ...state.detail,
        latestPlanJob: generated,
        draft: { ...state.detail.draft, plan: plan() },
      };
      return generated;
    },
    'works.confirmPlan': (input) => {
      const { baseContentRev } = input as { baseContentRev: number };
      const contentRev = baseContentRev + 1;
      state.confirmRevs.push(contentRev);
      state.detail = {
        ...state.detail,
        draft: {
          ...state.detail.draft,
          contentRev,
          plan: { ...(state.detail.draft.plan ?? plan()), confirmed: true },
        },
      };
      return { contentRev };
    },
    'works.generatePreview': (input) => {
      const { jobId, contentRev } = input as { jobId: string; contentRev: number };
      const running: PreviewJobView = {
        id: jobId,
        status: 'running',
        basedOnContentRev: contentRev,
        error: null,
        preview: null,
        updatedAt: Date.now(),
      };
      state.detail = { ...state.detail, latestPreviewJob: running };
      return running;
    },
    'works.adoptPreview': () => {
      state.detail = { ...state.detail, status: 'playable', title: '灯塔镇' };
      return { routeId: crypto.randomUUID() };
    },
    'works.applyDraft': (input) => {
      const { baseContentRev } = input as { baseContentRev: number };
      state.detail = { ...state.detail, hasUnpublishedChanges: false };
      return { contentRev: baseContentRev };
    },
    'works.adoptStalePlan': () => ({ contentRev: state.detail.draft.contentRev + 1 }),
    'works.updatePlanItem': () => ({ contentRev: state.detail.draft.contentRev + 1 }),
    'works.removePlanItem': () => ({ contentRev: state.detail.draft.contentRev + 1 }),
    'works.delete': () => ({}),
    'log.client': () => ({}),
    ...handlers,
  });
  return { ...fake, state };
}

async function renderAuthoring(detail: WorkDetail, handlers: Record<string, (input: unknown) => unknown> = {}) {
  const { api, calls, state } = makeApi(detail, handlers);
  const screen = await renderRoute(`/works/${detail.id}/edit`, { api });
  return { screen, calls, state, queryClient: screen.queryClient };
}

function callsTo(calls: FakeApiCall[], path: string): FakeApiCall[] {
  return calls.filter((call) => call.path === path);
}

describe('AuthoringPage', () => {
  it('无可访问性违规', async () => {
    const detail = workDetail({
      draft: {
        ...workDetail().draft,
        wizardStep: 'opening',
        plan: plan({ confirmed: true }),
      },
      latestPreviewJob: job({
        preview: preview({
          cast: [{ kind: 'character', name: '林远', knownAs: null, profile: '售票员。', protagonist: false }],
          initialState: [
            { label: '潮位', text: '3 米', visible: true },
            { label: '旧信', text: '空', visible: false },
          ],
          needsReview: [{ where: 'prose', index: 1, text: '阿岚拎着邮袋。', reason: 'hardcoded_name' }],
          options: [{ text: '问他在等谁', hint: '他可能是收信人之一。' }],
        }),
      }),
    });
    const { screen } = await renderAuthoring(detail);
    await expect.element(screen.getByRole('heading', { name: '开场' })).toBeVisible();
    await expectNoAxeViolations(document.body);
    await screen.unmount();
  });

  it('标题大纲正确', async () => {
    const detail = workDetail({
      draft: {
        ...workDetail().draft,
        wizardStep: 'opening',
        plan: plan({ confirmed: true }),
      },
      latestPreviewJob: job({
        preview: preview({
          cast: [{ kind: 'character', name: '林远', knownAs: null, profile: '售票员。', protagonist: false }],
        }),
      }),
    });
    const { screen } = await renderAuthoring(detail);
    await expect.element(screen.getByRole('heading', { name: '开场' })).toBeVisible();
    expectHeadingOutline(screen.container);
    await screen.unmount();
  });

  it('只写背景一路点到开场', async () => {
    const detail = workDetail();
    const { screen, calls, state } = await renderAuthoring(detail);
    const textarea = screen.getByRole('textbox', { name: '故事背景' });
    await expect.element(textarea).toBeVisible();
    await textarea.fill('海边小镇的灯塔只在夜里亮。');
    await screen.getByRole('button', { name: '生成故事方案' }).click();
    await expect.element(screen.getByText('刚到灯塔镇的邮差。')).toBeVisible();
    await screen.getByRole('button', { name: '确认方案，生成开场' }).click();
    await expect.element(screen.getByRole('heading', { name: '开场' })).toBeVisible();

    const confirmIndex = calls.findIndex((call) => call.path === 'works.confirmPlan');
    const previewIndex = calls.findIndex((call) => call.path === 'works.generatePreview');
    expect(confirmIndex).toBeGreaterThanOrEqual(0);
    expect(previewIndex).toBeGreaterThan(confirmIndex);
    expect(state.confirmRevs).toHaveLength(1);
    expect(calls[previewIndex]?.input).toMatchObject({
      workId: detail.id,
      contentRev: state.confirmRevs[0],
    });
    await screen.unmount();
  });

  it('当前步骤用 aria-current 标出', async () => {
    const detail = workDetail({
      draft: { ...workDetail().draft, plan: plan() },
    });
    const { screen, calls } = await renderAuthoring(detail);
    await expect.element(screen.getByRole('textbox', { name: '故事背景' })).toBeVisible();
    await screen.getByRole('button', { name: '方案' }).click();
    await expect.element(screen.getByRole('heading', { name: '故事方案' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: '方案' })).toHaveAttribute('aria-current', 'step');
    await expect.element(screen.getByRole('button', { name: '背景' })).not.toHaveAttribute('aria-current');
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toBe('故事方案');
    });
    expect(callsTo(calls, 'works.setWizardStep')[0]?.input).toMatchObject({ workId: detail.id, step: 'plan' });
    await screen.unmount();
  });

  it('方案没确认时不能进入开场', async () => {
    const detail = workDetail({
      draft: { ...workDetail().draft, plan: plan() },
    });
    const { screen } = await renderAuthoring(detail);
    await expect.element(screen.getByRole('textbox', { name: '故事背景' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: '开场' })).toBeDisabled();
    await screen.unmount();
  });

  it('重新生成开场的请求进行中时显示生成标记', async () => {
    let resolvePreview: (preview: PreviewJobView) => void = () => {};
    const previewPending = new Promise<PreviewJobView>((resolve) => {
      resolvePreview = resolve;
    });
    const detail = workDetail({
      draft: { ...workDetail().draft, wizardStep: 'opening', plan: plan({ confirmed: true }) },
      latestPreviewJob: job(),
    });
    const { screen } = await renderAuthoring(detail, { 'works.generatePreview': () => previewPending });
    await screen.getByRole('button', { name: '重新生成开场' }).click();
    await expect.element(screen.getByText('正在写开场')).toBeVisible();
    resolvePreview(job({ status: 'running', preview: null }));
    await screen.unmount();
  });

  it('待处理的句子挡住采用', async () => {
    const detail = workDetail({
      draft: { ...workDetail().draft, wizardStep: 'opening', plan: plan({ confirmed: true }) },
      latestPreviewJob: job({
        preview: preview({
          needsReview: [
            { where: 'prose', index: 1, text: '阿岚拎着邮袋走下跳板。', reason: 'hardcoded_name' },
            { where: 'option', index: 2, text: '问{{protagonist.称呼}}在等谁', reason: 'unknown_placeholder' },
          ],
        }),
      }),
    });
    const { screen } = await renderAuthoring(detail);
    const adopt = screen.getByRole('button', { name: '采用开场并存入作品库' });
    await expect.element(adopt).toBeDisabled();
    await expect.element(screen.getByText('先改好上面的句子，才能采用')).toBeVisible();

    const describedBy = adopt.element().getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    const card = document.getElementById(describedBy ?? '');
    expect(card?.textContent).toContain('第 1 段');
    expect(card?.textContent).toContain('写死了主角的名字，改成填写项');
    expect(card?.textContent).toContain('第 2 个推荐行动');
    await screen.unmount();
  });

  it('采用后开始故事进入开局页', async () => {
    const detail = workDetail({
      draft: { ...workDetail().draft, wizardStep: 'opening', plan: plan({ confirmed: true }) },
      latestPreviewJob: job(),
    });
    const { screen, calls } = await renderAuthoring(detail);
    await screen.getByRole('button', { name: '采用开场并存入作品库' }).click();
    await expect.element(screen.getByRole('heading', { name: '已存入作品库' })).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: '开始故事' }))
      .toHaveAttribute('href', `/works/${detail.id}/start`);
    expect(callsTo(calls, 'works.adoptPreview')[0]?.input).toMatchObject({
      workId: detail.id,
      jobId: detail.latestPreviewJob?.id,
    });
    await screen.unmount();
  });

  it('已发布作品仍可修改草稿并应用到新开局', async () => {
    const detail = workDetail({
      status: 'playable',
      title: '灯塔镇',
      hasUnpublishedChanges: true,
      routeCount: 2,
      draft: { ...workDetail().draft, wizardStep: 'background', plan: plan({ confirmed: true }) },
    });
    const { screen, calls, state } = await renderAuthoring(detail);
    await expect.element(screen.getByRole('textbox', { name: '故事背景' })).toBeVisible();
    await expectNoAxeViolations(document.body);
    await expect.element(screen.getByText(/现有的 2 条路线/)).toBeVisible();
    await screen.getByRole('button', { name: '应用到新开局' }).click();
    await vi.waitFor(() => {
      expect(callsTo(calls, 'works.applyDraft')[0]?.input).toMatchObject({
        workId: detail.id,
        baseContentRev: 3,
      });
    });
    await vi.waitFor(() => {
      expect(state.detail.hasUnpublishedChanges).toBe(false);
      expect(screen.getByRole('button', { name: '应用到新开局' }).query()).toBeNull();
    });
    await expect.element(screen.getByText('已应用到新开局')).toBeVisible();
    await screen.unmount();
  });

  it('方案改动未确认时不能应用草稿', async () => {
    const detail = workDetail({
      status: 'playable',
      hasUnpublishedChanges: true,
      routeCount: 0,
      draft: { ...workDetail().draft, plan: plan({ confirmed: false }) },
    });
    const { screen } = await renderAuthoring(detail);
    const apply = screen.getByRole('button', { name: '应用到新开局' });
    await expect.element(apply).toBeDisabled();
    await expect.element(screen.getByText('先确认故事方案，才能应用。')).toBeVisible();
    await screen.unmount();
  });

  it('方案正在生成时不能应用草稿', async () => {
    const detail = workDetail({
      status: 'playable',
      hasUnpublishedChanges: true,
      routeCount: 0,
      draft: { ...workDetail().draft, plan: plan({ confirmed: true }) },
      latestPlanJob: planJob({ status: 'running' }),
    });
    const { screen } = await renderAuthoring(detail);
    const apply = screen.getByRole('button', { name: '应用到新开局' });
    await expect.element(apply).toBeDisabled();
    await expect.element(screen.getByText('方案正在生成，完成后再应用。')).toBeVisible();
    await screen.unmount();
  });

  it('已发布作品采用新开场时按钮说明会应用到新开局', async () => {
    const detail = workDetail({
      status: 'playable',
      hasUnpublishedChanges: true,
      routeCount: 1,
      draft: { ...workDetail().draft, wizardStep: 'opening', plan: plan({ confirmed: true }) },
      latestPreviewJob: job(),
    });
    const { screen } = await renderAuthoring(detail);
    await expect.element(screen.getByRole('button', { name: '采用开场并应用到新开局' })).toBeVisible();
    await screen.unmount();
  });

  it('确认方案后上报一次 client.preview_visible', async () => {
    const detail = workDetail({
      draft: { ...workDetail().draft, wizardStep: 'plan', plan: plan() },
    });
    const { screen, calls, state, queryClient } = await renderAuthoring(detail);
    const confirm = screen.getByRole('button', { name: '确认方案，生成开场' });
    await expect.element(confirm).toBeEnabled();
    await confirm.click();
    await vi.waitFor(() => {
      expect(callsTo(calls, 'works.generatePreview')).toHaveLength(1);
    });

    const running = state.detail.latestPreviewJob;
    expect(running?.status).toBe('running');
    const done: PreviewJobView = { ...running!, status: 'done', preview: preview() };
    state.detail = { ...state.detail, latestPreviewJob: done };
    await queryClient.invalidateQueries({ queryKey: queryKeys.work(detail.id) });

    const previewSamples = () =>
      callsTo(calls, 'log.client').filter(
        (call) => (call.input as { metric?: string }).metric === 'client.preview_visible',
      );
    await vi.waitFor(() => {
      expect(previewSamples()).toHaveLength(1);
    });
    expect(previewSamples()[0]?.input).toMatchObject({
      metric: 'client.preview_visible',
      outcome: 'ok',
      workId: detail.id,
      jobId: done.id,
    });

    await queryClient.invalidateQueries({ queryKey: queryKeys.work(detail.id) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(previewSamples()).toHaveLength(1);
    await screen.unmount();
  });

  it('停止输入后自动保存一次', async () => {
    const detail = workDetail();
    const { screen, calls } = await renderAuthoring(detail);
    await screen.getByRole('textbox', { name: '故事背景' }).fill('最后一段背景。');
    await vi.waitFor(
      () => {
        expect(callsTo(calls, 'works.saveDraft')).toHaveLength(1);
      },
      { timeout: 3_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_DELAY_MS + 400));
    const saved = callsTo(calls, 'works.saveDraft');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.input).toEqual({
      workId: detail.id,
      baseContentRev: 3,
      background: '最后一段背景。',
      anchors: EMPTY_WORK_ANCHORS,
      settings: DEFAULT_WORK_SETTINGS,
    });
    await screen.unmount();
  });

  it('补充设定和背景一起保存', async () => {
    const detail = workDetail();
    const { screen, calls } = await renderAuthoring(detail);
    await screen.getByRole('textbox', { name: '故事背景' }).fill('新写的背景。');
    await screen.getByText('补充设定').click();
    await expect.element(screen.getByRole('textbox', { name: '叙事要求' })).toBeVisible();
    await screen.getByRole('textbox', { name: '叙事要求' }).fill('用第二人称写，句子短。');
    await screen.getByRole('textbox', { name: '内容边界' }).fill('不写血腥场面。');
    await screen.getByRole('textbox', { name: '即兴范围' }).fill('路人的名字可以现造。');
    await vi.waitFor(
      () => {
        const saved = callsTo(calls, 'works.saveDraft').find(
          (call) => (call.input as { anchors: WorkAnchors }).anchors.improvisationScope === '路人的名字可以现造。',
        );
        expect(saved).toBeDefined();
      },
      { timeout: 3_000 },
    );
    const saved = callsTo(calls, 'works.saveDraft').find(
      (call) => (call.input as { anchors: WorkAnchors }).anchors.improvisationScope === '路人的名字可以现造。',
    );
    expect(saved?.input).toMatchObject({
      background: '新写的背景。',
      anchors: {
        narrationDirective: '用第二人称写，句子短。',
        contentPolicy: '不写血腥场面。',
        improvisationScope: '路人的名字可以现造。',
      },
    });
    await expect.element(screen.getByText('补充设定（已填 3 项）')).toBeVisible();
    await screen.unmount();
  });

  it('生成前先保存未保存的修改', async () => {
    const detail = workDetail();
    const { screen, calls } = await renderAuthoring(detail);
    await screen.getByRole('textbox', { name: '故事背景' }).fill('新写的背景。');
    await screen.getByRole('button', { name: '生成故事方案' }).click();
    await vi.waitFor(() => {
      const saveIndex = calls.findIndex((call) => call.path === 'works.saveDraft');
      const generateIndex = calls.findIndex((call) => call.path === 'works.generatePlan');
      expect(saveIndex).toBeGreaterThanOrEqual(0);
      expect(generateIndex).toBeGreaterThan(saveIndex);
    });
    expect(callsTo(calls, 'works.saveDraft')[0]?.input).toMatchObject({ background: '新写的背景。' });
    expect(callsTo(calls, 'works.generatePlan')[0]?.input).toMatchObject({
      workId: detail.id,
      contentRev: 4,
    });
    await screen.unmount();
  });

  it('过期的预览不能采用', async () => {
    const detail = workDetail({
      draft: {
        contentRev: 5,
        background: '改过的背景。',
        anchors: EMPTY_WORK_ANCHORS,
        settings: DEFAULT_WORK_SETTINGS,
        wizardStep: 'opening',
        plan: plan({ confirmed: true }),
      },
      latestPreviewJob: job({ basedOnContentRev: 3 }),
    });
    const { screen } = await renderAuthoring(detail);
    await expect.element(screen.getByText('已过期')).toBeVisible();
    await expect.element(screen.getByText('背景改过了，这份预览基于旧的背景。请重新生成后再采用。')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: '采用开场并存入作品库' })).toBeDisabled();
    await screen.unmount();
  });

  it('预览列出开场里新出现的角色', async () => {
    const detail = workDetail({
      draft: { ...workDetail().draft, wizardStep: 'opening', plan: plan({ confirmed: true }) },
      latestPreviewJob: job({
        preview: preview({
          cast: [
            { kind: 'character', name: '林远', knownAs: null, profile: '刚到渡口的售票员。', protagonist: true },
            { kind: 'character', name: '周晴', knownAs: '等船的人', profile: '提着一只空鸟笼。', protagonist: false },
          ],
        }),
      }),
    });
    const { screen } = await renderAuthoring(detail);
    await expect.element(screen.getByRole('heading', { name: '开场里新出现的' })).toBeVisible();
    await expect.element(screen.getByText('林远')).toBeVisible();
    expect(screen.getByText('主角', { exact: true }).query()).toBeNull();
    await expect.element(screen.getByText('主角称作：等船的人')).toBeVisible();
    await screen.unmount();
  });

  it('显示开局状态和推荐行动的提醒', async () => {
    const detail = workDetail({
      draft: { ...workDetail().draft, wizardStep: 'opening', plan: plan({ confirmed: true }) },
      latestPreviewJob: job({
        preview: preview({
          options: [{ text: '问他在等谁', hint: '他可能是收信人之一。' }],
          initialState: [
            { label: '潮位', text: '3 米', visible: true },
            { label: '旧信', text: '空', visible: false },
          ],
        }),
      }),
    });
    const { screen } = await renderAuthoring(detail);
    await expect.element(screen.getByRole('heading', { name: '开局状态' })).toBeVisible();
    await expect.element(screen.getByText('潮位')).toBeVisible();
    await expect.element(screen.getByText('开局时不显示')).toBeVisible();
    await expect.element(screen.getByText('提醒：他可能是收信人之一。')).toBeVisible();
    await screen.unmount();
  });

  it('草稿在别处更新时保留本地文本', async () => {
    const detail = workDetail();
    const { screen, state, queryClient } = await renderAuthoring(detail);
    const textarea = screen.getByRole('textbox', { name: '故事背景' });
    await textarea.fill('正在本地写的草稿。');
    state.detail = {
      ...detail,
      draft: {
        ...detail.draft,
        contentRev: 7,
        background: '别处改过的背景。',
        anchors: EMPTY_WORK_ANCHORS,
      },
    };
    await queryClient.invalidateQueries({ queryKey: queryKeys.work(detail.id) });
    await expect.element(textarea).toHaveValue('正在本地写的草稿。');
    await screen.unmount();
  });
});
