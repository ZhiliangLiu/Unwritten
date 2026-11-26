import { describe, expect, it, vi } from 'vitest';
import type { Preview, PreviewJobView, WorkDetail } from '@unwritten/contracts';
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
    options: [{ text: '问他在等谁' }, { text: '告诉他今天没有船了' }],
    scene: { place: '候船厅', time: '深夜' },
    language: 'zh-CN',
    cast: [],
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
    routeId: null,
    draft: { contentRev: 3, background: '原来的背景。' },
    latestPreviewJob: null,
    ...overrides,
  };
}

function makeApi(initial: WorkDetail) {
  const state = { detail: initial };
  const fake = createFakeApi({
    'works.get': () => state.detail,
    'works.list': () => [],
    'works.saveBackground': (input) => {
      const { baseContentRev, background } = input as { baseContentRev: number; background: string };
      const contentRev = baseContentRev + 1;
      state.detail = { ...state.detail, draft: { contentRev, background } };
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
    'works.adoptPreview': () => ({ routeId: crypto.randomUUID() }),
    'log.client': () => ({}),
  });
  return { ...fake, state };
}

async function renderAuthoring(detail: WorkDetail) {
  const { api, calls, state } = makeApi(detail);
  const screen = await renderRoute(`/works/${detail.id}/edit`, { api });
  await expect.element(screen.getByRole('textbox', { name: '故事背景' })).toBeVisible();
  return { screen, calls, state, queryClient: screen.queryClient };
}

function callsTo(calls: FakeApiCall[], path: string): FakeApiCall[] {
  return calls.filter((call) => call.path === path);
}

describe('AuthoringPage', () => {
  it('无可访问性违规', async () => {
    const detail = workDetail({
      latestPreviewJob: job({
        preview: preview({
          cast: [{ kind: 'character', name: '林远', knownAs: null, profile: '售票员。', protagonist: true }],
        }),
      }),
    });
    const { screen } = await renderAuthoring(detail);
    await expect.element(screen.getByRole('heading', { name: '预览开场' })).toBeVisible();
    await expectNoAxeViolations(document.body);
    await screen.unmount();
  });

  it('标题大纲正确', async () => {
    const detail = workDetail({
      latestPreviewJob: job({
        preview: preview({
          cast: [{ kind: 'character', name: '林远', knownAs: null, profile: '售票员。', protagonist: true }],
        }),
      }),
    });
    const { screen } = await renderAuthoring(detail);
    await expect.element(screen.getByRole('heading', { name: '预览开场' })).toBeVisible();
    expectHeadingOutline(screen.container);
    await screen.unmount();
  });

  it('停止输入后自动保存一次', async () => {
    const detail = workDetail();
    const { screen, calls } = await renderAuthoring(detail);
    await screen.getByRole('textbox', { name: '故事背景' }).fill('最后一段背景。');
    await vi.waitFor(
      () => {
        expect(callsTo(calls, 'works.saveBackground')).toHaveLength(1);
      },
      { timeout: 3_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_DELAY_MS + 400));
    const saved = callsTo(calls, 'works.saveBackground');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.input).toEqual({
      workId: detail.id,
      baseContentRev: 3,
      background: '最后一段背景。',
    });
    await screen.unmount();
  });

  it('生成前先保存未保存的修改', async () => {
    const detail = workDetail();
    const { screen, calls } = await renderAuthoring(detail);
    await screen.getByRole('textbox', { name: '故事背景' }).fill('新写的背景。');
    await screen.getByRole('button', { name: '生成开场预览' }).click();
    await vi.waitFor(() => {
      const saveIndex = calls.findIndex((call) => call.path === 'works.saveBackground');
      const generateIndex = calls.findIndex((call) => call.path === 'works.generatePreview');
      expect(saveIndex).toBeGreaterThanOrEqual(0);
      expect(generateIndex).toBeGreaterThan(saveIndex);
    });
    expect(callsTo(calls, 'works.saveBackground')[0]?.input).toMatchObject({ background: '新写的背景。' });
    expect(callsTo(calls, 'works.generatePreview')[0]?.input).toMatchObject({
      workId: detail.id,
      contentRev: 4,
    });
    await screen.unmount();
  });

  it('过期的预览不能采用', async () => {
    const detail = workDetail({
      draft: { contentRev: 5, background: '改过的背景。' },
      latestPreviewJob: job({ basedOnContentRev: 3 }),
    });
    const { screen } = await renderAuthoring(detail);
    await expect.element(screen.getByText('已过期')).toBeVisible();
    await expect.element(screen.getByText('背景改过了，这份预览基于旧的背景。请重新生成后再采用。')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: '采用开场并存入作品库' })).toBeDisabled();
    await screen.unmount();
  });

  it('预览列出出场人物，主角带标记', async () => {
    const detail = workDetail({
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
    await expect.element(screen.getByRole('heading', { name: '出场人物' })).toBeVisible();
    await expect.element(screen.getByText('林远')).toBeVisible();
    await expect.element(screen.getByText(/^主角$/)).toBeVisible();
    await expect.element(screen.getByText('主角称作：等船的人')).toBeVisible();
    await screen.unmount();
  });

  it('草稿在别处更新时保留本地文本', async () => {
    const detail = workDetail();
    const { screen, state, queryClient } = await renderAuthoring(detail);
    const textarea = screen.getByRole('textbox', { name: '故事背景' });
    await textarea.fill('正在本地写的草稿。');
    state.detail = { ...detail, draft: { contentRev: 7, background: '别处改过的背景。' } };
    await queryClient.invalidateQueries({ queryKey: queryKeys.work(detail.id) });
    await expect.element(textarea).toHaveValue('正在本地写的草稿。');
    await screen.unmount();
  });
});
