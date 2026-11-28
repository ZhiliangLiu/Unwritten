import type {
  ImageConfigView,
  ImageServiceView,
  OutputOptionsView,
  PlaythroughView,
  PortraitDraftView,
  PortraitSetView,
  PortraitSlot,
  PortraitSlotView,
  StartIllustrationInfo,
  StartInfo,
  StartPlaythroughInput,
} from '@unwritten/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import type { FakeApiCall } from '../../shared/test/fake-api.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { renderRoute } from '../../shared/test/render.tsx';

const workId = '6a5b4c3d-2e1f-4a9b-8c7d-6e5f4a3b2c1d';
const serviceId = 'image-local-0a1b2c';
const activeSetId = '9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7e6f';

const illustrationInfo: StartIllustrationInfo = {
  available: true,
  autoEnabled: true,
  authorStyle: { kind: 'preset', preset: 'watercolor' },
  lastStyle: null,
  defaults: { aspectPreference: 'auto', resolutionTier: '1k' },
  protagonistEntityId: null,
};

function startInfo(overrides: Partial<StartIllustrationInfo>, fields: StartInfo['fields']): StartInfo {
  return {
    workId,
    title: '灯塔镇',
    fields,
    castMode: 'fixed',
    illustration: { ...illustrationInfo, ...overrides },
  };
}

function playthrough(id: string, route: string | null): PlaythroughView {
  return {
    id,
    workId,
    workTitle: '灯塔镇',
    routeId: route,
    opening: route ? null : { id: crypto.randomUUID(), status: 'running', error: null, attempts: 1, updatedAt: 1 },
  };
}

function service(state: ImageServiceView['state']): ImageServiceView {
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

function config(state: ImageServiceView['state']): ImageConfigView {
  return {
    status: 'ok',
    revision: 'revision-1',
    problem: null,
    services: [service(state)],
    selectedServiceId: serviceId,
  };
}

const output: OutputOptionsView = {
  preferences: { aspectPreference: 'auto', resolutionTier: '1k' },
  aspects: ['1:1', '3:4'],
  tiers: [
    { tier: '1k', sizes: { '1:1': { width: 1024, height: 1024 }, '3:4': { width: 768, height: 1024 } } },
    { tier: '2k', sizes: { '3:4': { width: 1536, height: 2048 } } },
  ],
  preferenceAvailable: true,
};

function slot(name: PortraitSlot, image: { width: number; height: number } | null): PortraitSlotView {
  return { slot: name, image, source: image ? 'generate' : null, needsReview: false, task: null };
}

const draft: PortraitSetView = {
  id: 'set-draft',
  workId,
  scope: 'pending',
  entityId: null,
  state: 'draft',
  draftRev: 0,
  appearance: '',
  slots: [slot('front', { width: 4, height: 4 }), slot('three_quarter', null), slot('full_body', null)],
  updatedAt: 1,
};

async function imageBlob(): Promise<Blob> {
  const canvas = new OffscreenCanvas(4, 4);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.fillRect(0, 0, 4, 4);
  return canvas.convertToBlob({ type: 'image/png' });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function startInputs(calls: FakeApiCall[]): StartPlaythroughInput[] {
  return calls.filter((call) => call.path === 'play.start').map((call) => call.input as StartPlaythroughInput);
}

async function setup(options: {
  illustration?: Partial<StartIllustrationInfo>;
  fields?: StartInfo['fields'];
  serviceState?: ImageServiceView['state'];
}) {
  const fields = options.fields ?? [{ name: '名字', defaultValue: '阿岚', isName: true }];
  const fake = createFakeApi({
    'play.getStartInfo': () => startInfo(options.illustration ?? {}, fields),
    'play.start': (input) => playthrough((input as StartPlaythroughInput).playthroughId, null),
    'play.getPlaythrough': (input) => playthrough((input as { playthroughId: string }).playthroughId, null),
    'play.suggestAppearance': () => ({ appearance: '短发，旧风衣，左手缠着绷带' }),
    'image.services.list': () => config(options.serviceState ?? 'ready'),
    'image.outputPreferences.get': () => output,
    'portrait.draft': () => ({ draft, activeSetId: null }) satisfies PortraitDraftView,
    'portrait.adopt': () => ({ draft: { ...draft, state: 'active' }, activeSetId }) satisfies PortraitDraftView,
    'image.file': () => imageBlob(),
  });
  const screen = await renderRoute(`/works/${workId}/start`, { api: fake.api });
  return { screen, fake };
}

async function openPanel(screen: Awaited<ReturnType<typeof setup>>['screen']) {
  await screen.getByRole('button', { name: /^插图/u }).click();
}

async function chooseInFrame(screen: Awaited<ReturnType<typeof setup>>['screen']) {
  await screen.getByText('画进插图').click();
  await expect.element(screen.getByRole('region', { name: '正面' })).toBeVisible();
}

describe('StartIllustrationPanel', () => {
  it('没有出图服务时整个块不渲染', async () => {
    const { screen } = await setup({ illustration: { available: false } });
    await expect.element(screen.getByRole('button', { name: '开始故事' })).toBeVisible();
    expect(screen.container.textContent).not.toContain('本局插图');
    expect(screen.container.textContent).not.toContain('本局纯文字');
    await screen.unmount();
  });

  it('默认收起，摘要显示本局的选择', async () => {
    const { screen } = await setup({});
    await expect.element(screen.getByText('本局插图 · 水彩 · 自动比例 · 高 · 1K')).toBeVisible();
    expect(screen.container.textContent).not.toContain('本局纯文字');
    await openPanel(screen);
    expect(screen.container.textContent).toContain('本局纯文字');
    expect(screen.container.textContent).toContain('画风会沿用到本局结束。');
    await screen.unmount();
  });

  it('自动出图没开时说明要先在设置里开启', async () => {
    const { screen } = await setup({ illustration: { autoEnabled: false } });
    await expect.element(screen.getByText('本局纯文字')).toBeVisible();
    await openPanel(screen);
    await expect.element(screen.getByText('请先在设置里开启「游玩时生成插图」。')).toBeVisible();
    await screen.unmount();
  });

  it('按设定写一个只填形象，不提交开局', async () => {
    const { screen, fake } = await setup({});
    await openPanel(screen);
    await chooseInFrame(screen);
    await screen.getByRole('button', { name: '按设定写一个' }).click();
    const appearance = screen.getByRole('textbox', { name: '主角形象' });
    await expect.element(appearance).toHaveValue('短发，旧风衣，左手缠着绷带');
    await sleep(50);
    expect(startInputs(fake.calls)).toHaveLength(0);
    await screen.unmount();
  });

  it('自己写留空时纯文字开局用作者默认画风', async () => {
    const { screen, fake } = await setup({});
    await openPanel(screen);
    await screen.getByText('自己写').click();
    await screen.getByText('本局纯文字').click();
    await screen.getByRole('button', { name: '开始故事' }).click();
    await vi.waitFor(() => {
      expect(startInputs(fake.calls)[0]?.illustration).toMatchObject({
        enabled: false,
        style: { kind: 'preset', preset: 'watercolor' },
      });
    });
    await screen.unmount();
  });

  it('自己写留空时插图开局用作者默认画风', async () => {
    const { screen, fake } = await setup({});
    await openPanel(screen);
    await screen.getByText('自己写').click();
    await screen.getByRole('button', { name: '开始故事' }).click();
    await vi.waitFor(() => {
      expect(startInputs(fake.calls)[0]?.illustration).toMatchObject({
        enabled: true,
        style: { kind: 'preset', preset: 'watercolor' },
      });
    });
    await screen.unmount();
  });

  it('用作本局参考后，开局带上这个参考组', async () => {
    const { screen, fake } = await setup({});
    await openPanel(screen);
    await chooseInFrame(screen);
    await screen.getByRole('button', { name: '用作本局参考' }).click();
    await vi.waitFor(() => {
      expect(fake.calls.filter((call) => call.path === 'portrait.draft').length).toBeGreaterThanOrEqual(2);
    });
    await screen.getByRole('button', { name: '开始故事' }).click();
    await vi.waitFor(() => {
      expect(startInputs(fake.calls)[0]?.illustration?.protagonistSnapshotId).toBe(activeSetId);
    });
    await screen.unmount();
  });

  it('不入画时开局不带形象和参考组', async () => {
    const { screen, fake } = await setup({});
    await openPanel(screen);
    await chooseInFrame(screen);
    await screen.getByRole('textbox', { name: '主角形象' }).fill('短发，旧风衣');
    await screen.getByRole('button', { name: '用作本局参考' }).click();
    await vi.waitFor(() => {
      expect(fake.calls.filter((call) => call.path === 'portrait.adopt').length).toBe(1);
      expect(fake.calls.filter((call) => call.path === 'portrait.draft').length).toBeGreaterThanOrEqual(2);
    });
    await screen.getByText('用主角视角，不画主角').click();
    await screen.getByRole('button', { name: '开始故事' }).click();
    await vi.waitFor(() => {
      const illustration = startInputs(fake.calls)[0]?.illustration;
      expect(illustration?.protagonistAppearance).toBeNull();
      expect(illustration?.protagonistSnapshotId).toBeNull();
    });
    await screen.unmount();
  });

  it('服务离线时说明原因，开始故事照常可用', async () => {
    const { screen } = await setup({ serviceState: 'offline' });
    await openPanel(screen);
    await expect.element(screen.getByText('连不上出图服务。服务恢复后可以重试。')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: '开始故事' })).toBeEnabled();
    await screen.unmount();
  });

  it('没有填写项但可配插图时，先选再开始', async () => {
    const { screen, fake } = await setup({ fields: [] });
    await expect.element(screen.getByRole('button', { name: /^插图/u })).toBeVisible();
    expect(startInputs(fake.calls)).toHaveLength(0);
    await screen.getByRole('button', { name: '开始故事' }).click();
    await vi.waitFor(() => {
      expect(startInputs(fake.calls)[0]?.illustration).toMatchObject({ enabled: true });
    });
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const { screen } = await setup({});
    await openPanel(screen);
    await chooseInFrame(screen);
    await expectNoAxeViolations(document.body);
    await screen.unmount();
  });
});
