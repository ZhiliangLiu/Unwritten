import { DEFAULT_APPEARANCE, LAUNCHER_STATES } from '@unwritten/contracts';
import type {
  ImageCapabilities,
  ImageConfigView,
  ImageServiceView,
  LlmConfigView,
  OutputOptionsView,
} from '@unwritten/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import settingsText from '../../i18n/zh-CN/settings.json';
import { queryKeys } from '../../shared/api/query.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import { renderRoute } from '../../shared/test/render.tsx';
import { applyAppearance } from '../../theme/appearance.ts';
import { LAUNCHER_STATE_LABEL_KEYS } from './ImageServiceCard.tsx';

const FAKE_TOKEN = 'test-token-0123456789abcdef0123456789abcdef';
const LOCAL_ID = 'image-local-0a1b2c';
const CLOUD_ID = 'image-cloud-1a2b3c';

const LOCAL_CAPABILITIES: ImageCapabilities = {
  maxReferences: 4,
  maxReferenceBytes: 20 * 1024 * 1024,
  maxPromptLength: 4000,
  seed: true,
  negativePrompt: true,
  qualities: ['fast', 'best'],
  aspects: ['3:2'],
  resolutions: { '3:2': { '2k': { width: 2048, height: 1360 } } },
};

const OPENAI_CAPABILITIES: ImageCapabilities = {
  maxReferences: 16,
  maxReferenceBytes: null,
  maxPromptLength: null,
  seed: false,
  negativePrompt: false,
  qualities: ['fast', 'best'],
  aspects: ['1:1', '3:2'],
  resolutions: { '1:1': { '1k': { width: 1024, height: 1024 } }, '3:2': { '1k': { width: 1536, height: 1024 } } },
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
  tiers: [
    { tier: '1k', sizes: { '3:2': { width: 1536, height: 1024 } } },
    { tier: '2k', sizes: { '3:2': { width: 3072, height: 2048 } } },
  ],
  preferenceAvailable: true,
};

function service(overrides: Partial<ImageServiceView> = {}): ImageServiceView {
  return {
    id: LOCAL_ID,
    name: '本机出图',
    protocol: 'unwritten-image',
    baseUrl: 'http://127.0.0.1:8188',
    key: { hasKey: true, source: 'file', envVar: null },
    model: null,
    openai: null,
    launcher: {
      baseUrl: 'http://127.0.0.1:8290',
      key: { hasKey: true, source: 'file', envVar: null },
    },
    idleMinutes: 30,
    capabilities: LOCAL_CAPABILITIES,
    probe: {
      at: Date.now() - 60_000,
      result: 'ready',
      notReadyReason: null,
      implementation: { name: 'unwritten-test-image', version: '1.2.3' },
      model: null,
    },
    lastSuccessAt: Date.now() - 120_000,
    state: 'ready',
    action: null,
    wakeFailure: null,
    ...overrides,
  };
}

function cloudService(): ImageServiceView {
  return service({
    id: CLOUD_ID,
    name: '云图',
    protocol: 'openai-images',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-image-2',
    openai: { maxReferences: 16, sizes: 'custom' },
    launcher: null,
    capabilities: OPENAI_CAPABILITIES,
    probe: null,
    lastSuccessAt: null,
    state: 'unknown',
  });
}

function imageConfig(services: ImageServiceView[], selectedServiceId: string | null): ImageConfigView {
  return { status: 'ok', revision: 'image-rev-1', problem: null, services, selectedServiceId };
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const startedAt = performance.now();
  while (!check()) {
    if (performance.now() - startedAt > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function chooseOption(trigger: HTMLButtonElement, optionText: string): Promise<void> {
  trigger.focus();
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await waitFor(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).some(
      (element) => element.textContent?.trim() === optionText,
    ),
  );
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (element) => element.textContent?.trim() === optionText,
  );
  if (!option) throw new Error(`option not found: ${optionText}`);
  option.focus();
  option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor(() => trigger.textContent?.includes(optionText) ?? false);
}

function cardByName(container: Element, name: string): HTMLElement | null {
  const heading = Array.from(container.querySelectorAll('h3')).find((element) => element.textContent?.trim() === name);
  return (heading?.closest('section') as HTMLElement | null) ?? null;
}

function buttonIn(container: Element, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label,
  );
  if (!button) throw new Error(`button not found: ${label}`);
  return button;
}

function inputByLabel(container: Element, label: string): HTMLInputElement | null {
  const fieldLabel = Array.from(container.querySelectorAll('label')).find(
    (element) => element.textContent?.trim() === label,
  );
  if (!fieldLabel?.htmlFor) return null;
  return container.querySelector<HTMLInputElement>(`#${CSS.escape(fieldLabel.htmlFor)}`);
}

function cacheContains(queryClient: QueryClient, token: string): boolean {
  const queries = queryClient
    .getQueryCache()
    .getAll()
    .map((query) => JSON.stringify(query.state.data ?? null))
    .join('');
  const mutations = queryClient
    .getMutationCache()
    .getAll()
    .map((mutation) => JSON.stringify({ variables: mutation.state.variables, data: mutation.state.data }))
    .join('');
  return queries.includes(token) || mutations.includes(token);
}

async function openSettings() {
  const baseConfig = imageConfig([service(), cloudService()], LOCAL_ID);
  const fake = createFakeApi({
    'settings.get': () => ({ ...DEFAULT_APPEARANCE }),
    'settings.update': (input) => input,
    'llm.providers.list': () => LLM_CONFIG,
    'image.services.list': () => baseConfig,
    'image.services.generateToken': () => ({ token: FAKE_TOKEN }),
    'image.services.create': (input) => {
      const created = service({
        id: 'image-created-abcdef',
        name: (input as { name: string }).name,
        protocol: (input as { protocol: ImageServiceView['protocol'] }).protocol,
        baseUrl: (input as { baseUrl: string }).baseUrl,
      });
      return { serviceId: created.id, config: imageConfig([...baseConfig.services, created], LOCAL_ID) };
    },
    'image.services.update': () => baseConfig,
    'image.services.remove': (input) => ({
      ...baseConfig,
      services: baseConfig.services.filter((item) => item.id !== (input as { serviceId: string }).serviceId),
    }),
    'image.services.test': (input) =>
      (input as { target: string }).target === 'launcher'
        ? {
            ok: true,
            code: null,
            service: null,
            launcher: {
              implementation: { name: 'unwritten-test-launcher', version: '2.0.0' },
              ready: true,
              notReadyReason: null,
              state: 'needs_action',
            },
            generated: null,
          }
        : {
            ok: true,
            code: null,
            service: {
              implementation: { name: 'unwritten-test-image', version: '1.2.3' },
              model: null,
              ready: true,
              notReadyReason: null,
              capabilities: LOCAL_CAPABILITIES,
            },
            launcher: null,
            generated: null,
          },
    'image.select': (input) => ({
      ...baseConfig,
      selectedServiceId: (input as { serviceId: string | null }).serviceId,
    }),
    'image.outputPreferences.get': () => OUTPUT_VIEW,
    'image.outputPreferences.set': (input) => ({ ...OUTPUT_VIEW, preferences: input }),
    'image.autoIllustration.get': () => ({ enabled: false, current: null, confirmed: null }),
    'image.autoIllustration.set': (input) => {
      const next = input as { enabled: boolean; confirm: unknown };
      return { enabled: next.enabled, current: next.confirm, confirmed: next.confirm };
    },
    'image.usage.summary': () => ({ services: [] }),
    'image.storage.summary': () => ({ files: 0, bytes: 0 }),
  });
  const result = await renderRoute('/settings', { api: fake.api });
  await waitFor(() =>
    Array.from(result.container.querySelectorAll('button')).some(
      (button) => button.textContent?.trim() === '添加出图服务',
    ),
  );
  return { ...result, fake };
}

beforeEach(() => {
  applyAppearance(DEFAULT_APPEARANCE);
});

describe('ImageServiceSection', () => {
  it('按协议显示服务卡和测试图操作', async () => {
    const { container, unmount } = await openSettings();
    await waitFor(() => cardByName(container, '本机出图') !== null && cardByName(container, '云图') !== null);
    const paidButtons = Array.from(container.querySelectorAll('button')).filter(
      (button) => button.textContent?.trim() === '生成测试图',
    );
    expect(paidButtons).toHaveLength(1);
    expect(cardByName(container, '云图')!.contains(paidButtons[0]!)).toBe(true);
    expect(cardByName(container, '本机出图')!.textContent).toContain('最多使用 4 张参考图');
    await unmount();
  });

  it('生成的令牌进入提交输入，不在查询或变更缓存里留存', async () => {
    const { container, fake, queryClient, getByRole, unmount } = await openSettings();
    await getByRole('button', { name: '添加出图服务' }).click();
    await getByRole('button', { name: '生成令牌' }).click();
    await waitFor(() => inputByLabel(container, '新令牌')?.value === FAKE_TOKEN);
    await getByRole('textbox', { name: '服务名称' }).fill('新服务');
    await getByRole('textbox', { name: '服务地址' }).fill('http://127.0.0.1:9000');
    await getByRole('button', { name: '保存出图服务' }).click();
    await waitFor(() => fake.calls.some((call) => call.path === 'image.services.create'));
    const call = fake.calls.find((item) => item.path === 'image.services.create')!;
    expect((call.input as { apiKey: string | null }).apiKey).toBe(FAKE_TOKEN);
    await waitFor(
      () =>
        !Array.from(container.querySelectorAll('button')).some(
          (button) => button.textContent?.trim() === '保存出图服务',
        ),
    );
    expect(container.textContent).not.toContain(FAKE_TOKEN);
    const cached = queryClient.getQueryData<ImageConfigView>(queryKeys.imageConfig);
    expect(cached?.services.some((item) => item.name === '新服务')).toBe(true);
    expect(cacheContains(queryClient, FAKE_TOKEN)).toBe(false);
    await getByRole('button', { name: '添加出图服务' }).click();
    await waitFor(() => buttonIn(container, '保存出图服务') !== undefined);
    expect(inputByLabel(container, '新令牌')).toBeNull();
    expect(container.textContent).not.toContain(FAKE_TOKEN);
    await unmount();
  });

  it('添加 OpenAI 服务时提交兼容设置', async () => {
    const { container, fake, getByRole, unmount } = await openSettings();
    await getByRole('button', { name: '添加出图服务' }).click();
    const protocolOption = Array.from(container.querySelectorAll('label')).find(
      (label) => label.textContent?.trim() === 'OpenAI 图像接口',
    );
    if (!protocolOption) throw new Error('OpenAI protocol option not found');
    protocolOption.click();
    await getByRole('textbox', { name: '服务名称' }).fill('云图二');
    await getByRole('textbox', { name: '服务地址' }).fill('https://api.example.com/v1');
    await getByRole('textbox', { name: '模型 ID' }).fill('test-image');
    await waitFor(() =>
      Array.from(container.querySelectorAll('button')).some((button) => button.textContent?.trim() === '兼容设置'),
    );
    buttonIn(container, '兼容设置').click();
    await waitFor(() =>
      Array.from(container.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'WebP'),
    );
    await chooseOption(buttonIn(container, 'WebP'), 'JPEG');
    await chooseOption(buttonIn(container, '不发送（服务默认）'), 'Base64（b64_json）');
    await chooseOption(buttonIn(container, '编辑接口'), '生成接口内联');
    await getByRole('checkbox', { name: '关闭服务水印' }).click();
    await getByRole('button', { name: '保存出图服务' }).click();
    await waitFor(() => fake.calls.some((call) => call.path === 'image.services.create'));
    const input = fake.calls.find((call) => call.path === 'image.services.create')!.input as { openai: unknown };
    expect(input.openai).toEqual({
      maxReferences: 0,
      sizes: 'fixed',
      outputFormat: 'jpeg',
      responseFormat: 'b64_json',
      referenceTransport: 'inline',
      disableWatermark: true,
    });
    await unmount();
  });

  it('编辑时不提交服务地址', async () => {
    const { container, fake, unmount } = await openSettings();
    await waitFor(() => cardByName(container, '本机出图') !== null);
    const card = cardByName(container, '本机出图')!;
    buttonIn(card, '编辑').click();
    await waitFor(() =>
      Array.from(card.querySelectorAll('button')).some((button) => button.textContent?.trim() === '保存出图服务'),
    );
    expect(card.textContent).toContain('http://127.0.0.1:8188');
    buttonIn(card, '保存出图服务').click();
    await waitFor(() => fake.calls.some((call) => call.path === 'image.services.update'));
    const call = fake.calls.find((item) => item.path === 'image.services.update')!;
    expect(Object.hasOwn(call.input as object, 'baseUrl')).toBe(false);
    expect((call.input as { name: string }).name).toBe('本机出图');
    await unmount();
  });

  it('编辑 OpenAI 兼容设置并提交', async () => {
    const { container, fake, getByRole, unmount } = await openSettings();
    await waitFor(() => cardByName(container, '云图') !== null);
    const card = cardByName(container, '云图')!;
    buttonIn(card, '编辑').click();
    await waitFor(() =>
      Array.from(card.querySelectorAll('button')).some((button) => button.textContent?.trim() === '兼容设置'),
    );
    buttonIn(card, '兼容设置').click();
    await waitFor(() =>
      Array.from(card.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'WebP'),
    );
    await chooseOption(buttonIn(card, 'WebP'), 'JPEG');
    await chooseOption(buttonIn(card, '不发送（服务默认）'), 'Base64（b64_json）');
    await chooseOption(buttonIn(card, '编辑接口'), '生成接口内联');
    await getByRole('checkbox', { name: '关闭服务水印' }).click();
    buttonIn(card, '保存出图服务').click();
    await waitFor(() => fake.calls.some((call) => call.path === 'image.services.update'));
    const input = fake.calls.find((call) => call.path === 'image.services.update')!.input as { openai: unknown };
    expect(input.openai).toEqual({
      maxReferences: 16,
      sizes: 'custom',
      outputFormat: 'jpeg',
      responseFormat: 'b64_json',
      referenceTransport: 'inline',
      disableWatermark: true,
    });
    await unmount();
  });

  it('改服务 key 时不动启动器 key', async () => {
    const { container, fake, unmount } = await openSettings();
    await waitFor(() => cardByName(container, '本机出图') !== null);
    const card = cardByName(container, '本机出图')!;
    buttonIn(card, '编辑').click();
    await waitFor(() =>
      Array.from(card.querySelectorAll('button')).some((button) => button.textContent?.trim() === '保留已保存的 key'),
    );
    await chooseOption(buttonIn(card, '保留已保存的 key'), '设置新 key');
    const generateButtons = Array.from(card.querySelectorAll('button')).filter(
      (button) => button.textContent?.trim() === '生成令牌',
    );
    expect(generateButtons).toHaveLength(2);
    generateButtons[0]!.click();
    await waitFor(() => inputByLabel(card, '新令牌')?.value === FAKE_TOKEN);
    buttonIn(card, '保存出图服务').click();
    await waitFor(() => fake.calls.some((call) => call.path === 'image.services.update'));
    const input = fake.calls.find((call) => call.path === 'image.services.update')!.input as {
      key: unknown;
      launcher: unknown;
    };
    expect(input.key).toEqual({ action: 'set', value: FAKE_TOKEN });
    expect(input.launcher).toEqual({ action: 'keep', key: { action: 'keep' } });
    expect(JSON.stringify(input.launcher)).not.toContain(FAKE_TOKEN);
    await unmount();
  });

  it('显式改启动器 key 时发送新 key', async () => {
    const { container, fake, unmount } = await openSettings();
    await waitFor(() => cardByName(container, '本机出图') !== null);
    const card = cardByName(container, '本机出图')!;
    buttonIn(card, '编辑').click();
    await waitFor(() =>
      Array.from(card.querySelectorAll('button')).some((button) => button.textContent?.trim() === '生成令牌'),
    );
    const generateButtons = Array.from(card.querySelectorAll('button')).filter(
      (button) => button.textContent?.trim() === '生成令牌',
    );
    expect(generateButtons).toHaveLength(1);
    generateButtons[0]!.click();
    await waitFor(() => inputByLabel(card, '新令牌')?.value === FAKE_TOKEN);
    buttonIn(card, '保存出图服务').click();
    await waitFor(() => fake.calls.some((call) => call.path === 'image.services.update'));
    const input = fake.calls.find((call) => call.path === 'image.services.update')!.input as {
      key: unknown;
      launcher: unknown;
    };
    expect(input.key).toEqual({ action: 'keep' });
    expect(input.launcher).toEqual({
      action: 'set',
      baseUrl: 'http://127.0.0.1:8290',
      apiKey: FAKE_TOKEN,
    });
    await unmount();
  });

  it('删除选中的服务时说明会停止出图', async () => {
    const { container, fake, unmount } = await openSettings();
    await waitFor(() => cardByName(container, '本机出图') !== null);
    buttonIn(cardByName(container, '本机出图')!, '删除出图服务').click();
    await waitFor(() => document.querySelector('[role="alertdialog"]') !== null);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('删除正在使用的「本机出图」后，新的插图将停止生成。');
    buttonIn(dialog, '删除出图服务').click();
    await waitFor(() => fake.calls.some((call) => call.path === 'image.services.remove'));
    expect(
      (fake.calls.find((call) => call.path === 'image.services.remove')!.input as { serviceId: string }).serviceId,
    ).toBe(LOCAL_ID);
    await unmount();
  });

  it('测试启动器显示当前状态', async () => {
    const { container, unmount } = await openSettings();
    await waitFor(() => cardByName(container, '本机出图') !== null);
    const card = cardByName(container, '本机出图')!;
    buttonIn(card, '测试启动器').click();
    await waitFor(() => card.textContent?.includes('等待授权') ?? false);
    expect(card.textContent).toContain('unwritten-test-launcher 2.0.0');
    await unmount();
  });

  it('每个启动器状态都有文案', () => {
    expect(LAUNCHER_STATES.length).toBeGreaterThan(0);
    for (const state of LAUNCHER_STATES) {
      expect(LAUNCHER_STATE_LABEL_KEYS[state], state).toBeTruthy();
      expect(settingsText.images.launcherState[state]).not.toBe('');
    }
  });

  it('无可访问性违规', async () => {
    const { container, unmount } = await openSettings();
    await waitFor(() => cardByName(container, '本机出图') !== null);
    await expectNoAxeViolations(container);
    await unmount();
  });
});
