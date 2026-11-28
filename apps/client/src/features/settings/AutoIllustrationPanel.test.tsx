import { DEFAULT_APPEARANCE } from '@unwritten/contracts';
import type {
  AutoIllustrationTarget,
  AutoIllustrationView,
  ImageConfigView,
  ImageServiceView,
  LlmConfigView,
  OutputOptionsView,
} from '@unwritten/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import { renderRoute } from '../../shared/test/render.tsx';
import { applyAppearance } from '../../theme/appearance.ts';

const LOCAL_ID = 'image-local-0a1b2c';

const TARGET: AutoIllustrationTarget = {
  serviceId: LOCAL_ID,
  model: null,
  background: { endpointId: 'ep-1', modelId: 'writer-model' },
};

const SERVICE: ImageServiceView = {
  id: LOCAL_ID,
  name: '本机出图',
  protocol: 'unwritten-image',
  baseUrl: 'http://127.0.0.1:8188',
  key: { hasKey: true, source: 'file', envVar: null },
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
};

const IMAGE_CONFIG: ImageConfigView = {
  status: 'ok',
  revision: 'image-rev-1',
  problem: null,
  services: [SERVICE],
  selectedServiceId: LOCAL_ID,
};

const LLM_CONFIG: LlmConfigView = {
  status: 'ok',
  revision: 'llm-rev-1',
  problem: null,
  endpoints: [
    {
      id: 'ep-1',
      name: '本地模型',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:11434/v1',
      key: { hasKey: true, source: 'file', envVar: null },
      models: [
        {
          id: 'writer-model',
          contextWindow: null,
          maxTokens: null,
          tools: true,
          reasoning: false,
          thinkingFormat: 'auto',
        },
      ],
    },
  ],
  purposes: [],
};

const OUTPUT_VIEW: OutputOptionsView = {
  preferences: { aspectPreference: 'auto', resolutionTier: '1k' },
  aspects: ['3:2'],
  tiers: [{ tier: '1k', sizes: { '3:2': { width: 1536, height: 1024 } } }],
  preferenceAvailable: true,
};

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const startedAt = performance.now();
  while (!check()) {
    if (performance.now() - startedAt > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function openSettings(auto: AutoIllustrationView) {
  const fake = createFakeApi({
    'settings.get': () => ({ ...DEFAULT_APPEARANCE }),
    'settings.update': (input) => input,
    'llm.providers.list': () => LLM_CONFIG,
    'image.services.list': () => IMAGE_CONFIG,
    'image.autoIllustration.get': () => auto,
    'image.autoIllustration.set': (input) => {
      const next = input as { enabled: boolean; confirm: AutoIllustrationTarget | null };
      return { enabled: next.enabled, current: TARGET, confirmed: next.confirm };
    },
    'image.outputPreferences.get': () => OUTPUT_VIEW,
    'image.outputPreferences.set': (input) => ({ ...OUTPUT_VIEW, preferences: input }),
    'image.usage.summary': () => ({ services: [] }),
    'image.storage.summary': () => ({ files: 0, bytes: 0 }),
  });
  const result = await renderRoute('/settings', { api: fake.api });
  await waitFor(() => result.container.querySelector('input[type="checkbox"]') !== null);
  return { ...result, fake };
}

beforeEach(() => {
  applyAppearance(DEFAULT_APPEARANCE);
});

describe('AutoIllustrationPanel', () => {
  it('打开开关先确认，取消不设置，确认时带上当前接收方', async () => {
    const { container, fake, getByRole, unmount } = await openSettings({
      enabled: false,
      current: TARGET,
      confirmed: null,
    });
    const toggle = getByRole('checkbox', { name: '游玩时生成插图' });
    await expect.element(toggle).toBeVisible();
    await toggle.click();
    await expect.element(getByRole('button', { name: '确认开启' })).toBeVisible();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('「本地模型」的 writer-model 会收到正文片段、人物形象和镜头约束。');
    expect(dialog.textContent).toContain('「本机出图」会收到提示词和选中的参考图。');
    await getByRole('button', { name: '取消' }).click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.calls.some((call) => call.path === 'image.autoIllustration.set')).toBe(false);
    await toggle.click();
    await getByRole('button', { name: '确认开启' }).click();
    await waitFor(() => fake.calls.some((call) => call.path === 'image.autoIllustration.set'));
    expect(fake.calls.find((call) => call.path === 'image.autoIllustration.set')!.input).toEqual({
      enabled: true,
      confirm: TARGET,
    });
    expect(container.textContent).not.toContain('开启自动出图？');
    await unmount();
  });

  it('没有可确认的接收方时开关禁用', async () => {
    const { container, getByRole, unmount } = await openSettings({ enabled: false, current: null, confirmed: null });
    const toggle = getByRole('checkbox', { name: '游玩时生成插图' });
    await expect.element(toggle).toBeVisible();
    expect((toggle.element() as HTMLInputElement).disabled).toBe(true);
    expect(container.textContent).toContain('请先选择出图服务，并为镜头描述配置 background 用途。');
    await unmount();
  });

  it('接收方变化后提示重新确认', async () => {
    const { container, unmount } = await openSettings({
      enabled: false,
      current: TARGET,
      confirmed: TARGET,
    });
    expect(container.textContent).toContain('数据接收方变了。请重新确认后开启。');
    await unmount();
  });

  it('无可访问性违规', async () => {
    const { container, getByRole, unmount } = await openSettings({
      enabled: false,
      current: TARGET,
      confirmed: null,
    });
    await expect.element(getByRole('checkbox', { name: '游玩时生成插图' })).toBeVisible();
    await expectNoAxeViolations(container);
    await unmount();
  });
});
