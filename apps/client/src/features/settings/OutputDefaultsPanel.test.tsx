import { DEFAULT_APPEARANCE } from '@unwritten/contracts';
import type { ImageConfigView, ImageServiceView, LlmConfigView, OutputOptionsView } from '@unwritten/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import { renderRoute } from '../../shared/test/render.tsx';
import { applyAppearance } from '../../theme/appearance.ts';

const SERVICE: ImageServiceView = {
  id: 'image-local-0a1b2c',
  name: '本机出图',
  protocol: 'unwritten-image',
  baseUrl: 'http://127.0.0.1:8188',
  key: { hasKey: true, source: 'file', envVar: null },
  model: null,
  openai: null,
  launcher: null,
  idleMinutes: 30,
  capabilities: {
    maxReferences: 0,
    maxReferenceBytes: null,
    maxPromptLength: null,
    seed: false,
    negativePrompt: false,
    qualities: ['best'],
    aspects: ['3:2'],
    resolutions: { '3:2': { '2k': { width: 3072, height: 2048 } } },
  },
  probe: null,
  lastSuccessAt: null,
  capabilitiesAt: null,
  state: 'ready',
  action: null,
  wakeFailure: null,
};

const IMAGE_CONFIG: ImageConfigView = {
  status: 'ok',
  revision: 'image-rev-1',
  problem: null,
  services: [SERVICE],
  selectedServiceId: SERVICE.id,
};

const LLM_CONFIG: LlmConfigView = {
  status: 'ok',
  revision: 'llm-rev-1',
  problem: null,
  endpoints: [],
  purposes: [],
};

const ONE_TIER: OutputOptionsView = {
  preferences: { aspectPreference: 'auto', resolutionTier: '2k' },
  aspects: ['3:2'],
  tiers: [{ tier: '2k', sizes: { '3:2': { width: 3072, height: 2048 } } }],
  preferenceAvailable: true,
};

const TWO_TIERS: OutputOptionsView = {
  preferences: { aspectPreference: 'auto', resolutionTier: '1k' },
  aspects: ['3:2'],
  tiers: [
    { tier: '1k', sizes: { '3:2': { width: 1536, height: 1024 } } },
    { tier: '2k', sizes: { '3:2': { width: 3072, height: 2048 } } },
  ],
  preferenceAvailable: true,
};

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const startedAt = performance.now();
  while (!check()) {
    if (performance.now() - startedAt > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function optionLabels(container: Element): string[] {
  return Array.from(container.querySelectorAll('label')).map((label) => label.textContent?.trim() ?? '');
}

function clickOption(container: Element, text: string): void {
  const label = Array.from(container.querySelectorAll('label')).find((element) => element.textContent?.trim() === text);
  if (!label) throw new Error(`option not found: ${text}`);
  label.click();
}

async function openSettings(output: OutputOptionsView) {
  const fake = createFakeApi({
    'settings.get': () => ({ ...DEFAULT_APPEARANCE }),
    'settings.update': (input) => input,
    'llm.providers.list': () => LLM_CONFIG,
    'image.services.list': () => IMAGE_CONFIG,
    'image.outputPreferences.get': () => output,
    'image.outputPreferences.set': (input) => ({ ...output, preferences: input }),
    'image.autoIllustration.get': () => ({ enabled: false, current: null, confirmed: null }),
    'image.autoIllustration.set': () => ({ enabled: false, current: null, confirmed: null }),
    'image.usage.summary': () => ({ services: [] }),
    'image.storage.summary': () => ({ files: 0, bytes: 0 }),
  });
  const result = await renderRoute('/settings', { api: fake.api });
  await waitFor(() =>
    Array.from(result.container.querySelectorAll('label')).some((label) => label.textContent?.trim() === '自动比例'),
  );
  return { ...result, fake };
}

beforeEach(() => {
  applyAppearance(DEFAULT_APPEARANCE);
});

describe('OutputDefaultsPanel', () => {
  it('自动比例只显示服务支持的档位，固定比例不支持时不显示', async () => {
    const first = await openSettings(ONE_TIER);
    expect(optionLabels(first.container)).toContain('非常高 · 2K');
    expect(first.container.textContent).toContain('当前只有这一档可用。');
    await first.unmount();

    const second = await openSettings({
      ...ONE_TIER,
      preferences: { aspectPreference: '3:4', resolutionTier: '2k' },
      preferenceAvailable: false,
    });
    expect(optionLabels(second.container)).not.toContain('非常高 · 2K');
    expect(second.container.textContent).not.toContain('非常高 · 2K');
    expect(second.container.textContent).toContain('当前服务不支持已选规格，请重新选择。');
    await second.unmount();
  });

  it('改档位后发送新的偏好', async () => {
    const { fake, container, unmount } = await openSettings(TWO_TIERS);
    clickOption(container, '非常高 · 2K');
    await waitFor(() => fake.calls.some((call) => call.path === 'image.outputPreferences.set'));
    expect(fake.calls.find((call) => call.path === 'image.outputPreferences.set')!.input).toEqual({
      aspectPreference: 'auto',
      resolutionTier: '2k',
    });
    await unmount();
  });

  it('无可访问性违规', async () => {
    const { container, unmount } = await openSettings(TWO_TIERS);
    await expectNoAxeViolations(container);
    await unmount();
  });
});
