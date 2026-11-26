import { ORPCError } from '@orpc/client';
import { DEFAULT_APPEARANCE, EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
import type {
  ConfigProblem,
  EndpointView,
  GenerationParams,
  LlmConfigView,
  LlmPurpose,
  ModelCapabilities,
  ModelRef,
  PurposeProblem,
  PurposeView,
} from '@unwritten/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryKeys } from '../../shared/api/query.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import { expectHeadingOutline } from '../../shared/test/heading-outline.ts';
import { renderRoute } from '../../shared/test/render.tsx';
import { applyAppearance } from '../../theme/appearance.ts';

const writer: ModelCapabilities = {
  id: 'writer-model',
  contextWindow: null,
  maxTokens: null,
  tools: true,
  reasoning: true,
  thinkingFormat: 'openai',
};

const qwen: ModelCapabilities = {
  id: 'qwen-model',
  contextWindow: null,
  maxTokens: null,
  tools: true,
  reasoning: true,
  thinkingFormat: 'qwen',
};

const plain: ModelCapabilities = {
  id: 'plain-model',
  contextWindow: null,
  maxTokens: null,
  tools: false,
  reasoning: false,
  thinkingFormat: 'auto',
};

const writerRef: ModelRef = { endpointId: 'ep-1', modelId: writer.id };
const qwenRef: ModelRef = { endpointId: 'ep-1', modelId: qwen.id };

function endpointOf(models: ModelCapabilities[]): EndpointView {
  return {
    id: 'ep-1',
    name: '墨舟',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:11434/v1',
    key: { hasKey: true, source: 'file', envVar: null },
    models,
  };
}

function purposeView(
  purpose: LlmPurpose,
  model: ModelRef | null,
  options: {
    params?: Partial<GenerationParams>;
    effectiveModel?: ModelRef | null;
    inherited?: boolean;
    problem?: PurposeProblem | null;
  } = {},
): PurposeView {
  const params = { ...EMPTY_GENERATION_PARAMS, ...options.params };
  return {
    purpose,
    model,
    params,
    inherited: options.inherited ?? model === null,
    effectiveModel: options.effectiveModel ?? model,
    effectiveParams: params,
    problem: options.problem ?? null,
  };
}

function configOf(
  options: {
    models?: ModelCapabilities[];
    purposes?: PurposeView[];
    problem?: ConfigProblem | null;
    status?: LlmConfigView['status'];
    revision?: string;
  } = {},
): LlmConfigView {
  const models = options.models ?? [writer, qwen];
  const purposes = options.purposes ?? [
    purposeView('default', writerRef),
    purposeView('narrator', null, { effectiveModel: writerRef }),
    purposeView('background', null, { effectiveModel: writerRef }),
  ];
  return {
    status: options.status ?? 'ok',
    revision: options.revision ?? 'rev-1',
    problem: options.problem ?? null,
    endpoints: [endpointOf(models)],
    purposes,
  };
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const startedAt = performance.now();
  while (!check()) {
    if (performance.now() - startedAt > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function cardByName(container: Element, name: string): HTMLElement | null {
  const heading = Array.from(container.querySelectorAll('h3')).find((element) => element.textContent?.trim() === name);
  return (heading?.closest('section') as HTMLElement | null) ?? null;
}

function endpointCard(container: Element): HTMLElement | null {
  const heading = Array.from(container.querySelectorAll('h4')).find(
    (element) => element.textContent?.trim() === '墨舟',
  );
  return (heading?.closest('section') as HTMLElement | null) ?? null;
}

function numberInputs(card: Element): HTMLInputElement[] {
  return Array.from(card.querySelectorAll<HTMLInputElement>('input')).filter(
    (input) => !input.hasAttribute('aria-hidden'),
  );
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') as
    Record<string, unknown> | undefined;
  const setter = descriptor?.['set'];
  if (typeof setter === 'function') Reflect.apply(setter, input, [value]);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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

async function renderSettings(
  options: {
    config?: LlmConfigView;
    handlers?: Record<string, (input: unknown) => unknown>;
  } = {},
) {
  const config = options.config ?? configOf();
  const fake = createFakeApi({
    'settings.get': () => ({ ...DEFAULT_APPEARANCE }),
    'settings.update': (input) => input,
    'llm.providers.list': () => config,
    'llm.purposes.set': () => config,
    'llm.models.update': () => config,
    'llm.models.add': () => config,
    'llm.models.remove': () => config,
    'llm.endpoints.update': () => config,
    'llm.endpoints.remove': () => config,
    'llm.endpoints.create': () => ({ endpointId: 'ep-2', config }),
    'llm.test': () => ({ ok: true, code: null, detail: null, savedToolsCapability: true }),
    ...options.handlers,
  });
  const result = await renderRoute('/settings', { api: fake.api });
  await waitFor(() => cardByName(result.container, '默认') !== null);
  return { ...result, fake };
}

beforeEach(() => {
  applyAppearance(DEFAULT_APPEARANCE);
});

describe('SettingsPage', () => {
  it('无可访问性违规', async () => {
    const { container, unmount } = await renderSettings();
    await expectNoAxeViolations(container);
    await unmount();
  });

  it('标题大纲正确', async () => {
    const { container, unmount } = await renderSettings();
    expectHeadingOutline(container);
    await unmount();
  });

  it('保存用途时发送模型和参数', async () => {
    const { container, fake, unmount } = await renderSettings();
    const card = cardByName(container, '默认')!;
    const buttons = card.querySelectorAll<HTMLButtonElement>('button');
    await chooseOption(buttons[0]!, '墨舟 · qwen-model');
    await chooseOption(buttons[1]!, '高');
    const inputs = numberInputs(card);
    setInputValue(inputs[1]!, '0.7');
    const save = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '保存',
    )!;
    save.click();
    await waitFor(() => fake.calls.some((call) => call.path === 'llm.purposes.set'));
    const call = fake.calls.find((item) => item.path === 'llm.purposes.set')!;
    const input = call.input as { purpose: LlmPurpose; model: ModelRef | null; params: GenerationParams };
    expect(input.purpose).toBe('default');
    expect(input.model).toEqual(qwenRef);
    expect(input.params.thinking).toBe('high');
    expect(input.params.temperature).toBe(0.7);
    await unmount();
  });

  it('模型不支持思考时思考档位禁用并说明原因', async () => {
    const { container, unmount } = await renderSettings({
      config: configOf({
        models: [plain],
        purposes: [purposeView('default', { endpointId: 'ep-1', modelId: plain.id }, { params: { thinking: 'high' } })],
      }),
    });
    const card = cardByName(container, '默认')!;
    const thinkingTrigger = card.querySelectorAll<HTMLButtonElement>('button')[1]!;
    expect(
      thinkingTrigger.disabled ||
        thinkingTrigger.getAttribute('aria-disabled') === 'true' ||
        thinkingTrigger.hasAttribute('data-disabled'),
    ).toBe(true);
    expect(card.textContent).toContain('这个模型标为不支持思考。');
    await unmount();
  });

  it('预算只对 qwen 写法可用', async () => {
    const { container, unmount } = await renderSettings({
      config: configOf({
        models: [qwen, writer],
        purposes: [
          purposeView('default', qwenRef, { params: { thinking: 'medium' } }),
          purposeView('narrator', writerRef, { params: { thinking: 'medium' } }),
          purposeView('background', null, { effectiveModel: qwenRef }),
        ],
      }),
    });
    const defaultBudget = numberInputs(cardByName(container, '默认')!)[0]!;
    const narratorCard = cardByName(container, '游玩')!;
    const narratorBudget = numberInputs(narratorCard)[0]!;
    expect(defaultBudget.disabled).toBe(false);
    expect(narratorBudget.disabled).toBe(true);
    expect(narratorCard.textContent).toContain('只有思考写法为 Qwen 的模型能设思考预算。');
    await unmount();
  });

  it('同时设思考和采样参数时出现提示', async () => {
    const { container, unmount } = await renderSettings({
      config: configOf({
        purposes: [
          purposeView('default', writerRef, { params: { thinking: 'high', temperature: 0.7 } }),
          purposeView('narrator', null, { effectiveModel: writerRef }),
          purposeView('background', writerRef, { params: { temperature: 0.7 } }),
        ],
      }),
    });
    expect(cardByName(container, '默认')!.textContent).toContain(
      '开启思考后，部分服务会忽略或拒绝采样参数。请用测试连接确认。',
    );
    expect(cardByName(container, '后台摘要')!.textContent).not.toContain(
      '开启思考后，部分服务会忽略或拒绝采样参数。请用测试连接确认。',
    );
    await unmount();
  });

  it('删除模型前确认，并列出会清除的用途', async () => {
    const { container, fake, unmount } = await renderSettings({
      config: configOf({
        purposes: [
          purposeView('default', writerRef),
          purposeView('narrator', qwenRef),
          purposeView('background', null, { effectiveModel: writerRef }),
        ],
      }),
    });
    const card = endpointCard(container)!;
    const deleteButtons = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).filter(
      (button) => button.textContent === '删除模型',
    );
    deleteButtons[1]!.click();
    await waitFor(() => document.querySelector('[role="alertdialog"]') !== null);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('这些用途的设置会被清除：游玩');
    const confirm = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '删除模型',
    )!;
    confirm.click();
    await waitFor(() => fake.calls.some((call) => call.path === 'llm.models.remove'));
    const call = fake.calls.find((item) => item.path === 'llm.models.remove')!;
    expect(call.input).toMatchObject({ endpointId: 'ep-1', modelId: qwen.id });
    await unmount();
  });

  it('端点只剩一个模型时不能删除模型', async () => {
    const { container, unmount } = await renderSettings({ config: configOf({ models: [writer] }) });
    const card = endpointCard(container)!;
    const deleteButton = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '删除模型',
    )!;
    expect(deleteButton.disabled).toBe(true);
    expect(card.textContent).toContain('端点至少要保留一个模型。');
    await unmount();
  });

  it('修改端点时不发送 modelId', async () => {
    const { container, fake, unmount } = await renderSettings();
    const card = endpointCard(container)!;
    const more = card.querySelector<HTMLButtonElement>('button[aria-label="端点“墨舟”的更多操作"]')!;
    more.click();
    await waitFor(() => document.querySelector('[role="menuitem"]') !== null);
    const edit = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent === '修改名称和 key',
    )!;
    edit.click();
    await waitFor(() =>
      Array.from(card.querySelectorAll('button')).some((button) => button.textContent === '保存端点'),
    );
    const save = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '保存端点',
    )!;
    save.click();
    await waitFor(() => fake.calls.some((call) => call.path === 'llm.endpoints.update'));
    const call = fake.calls.find((item) => item.path === 'llm.endpoints.update')!;
    expect(Object.hasOwn(call.input as object, 'modelId')).toBe(false);
    await unmount();
  });

  it('改外观立即生效，保存失败时恢复', async () => {
    const { container, unmount } = await renderSettings({
      handlers: {
        'settings.update': () => {
          throw new ORPCError('save');
        },
      },
    });
    const dark = Array.from(container.querySelectorAll('label')).find((label) => label.textContent?.trim() === '深色')!;
    dark.click();
    expect(document.documentElement.getAttribute('data-uw-appearance')).toBe('dark');
    await waitFor(() => document.documentElement.getAttribute('data-uw-appearance') === 'system');
    await waitFor(() => (document.body.textContent ?? '').includes('外观设置没有保存，已恢复原来的设置。'));
    await unmount();
  });

  it('服务端配置变化不覆盖未保存的表单', async () => {
    let config = configOf();
    const { container, queryClient, fake, unmount } = await renderSettings({
      handlers: { 'llm.providers.list': () => config },
    });
    const defaultCard = cardByName(container, '默认')!;
    await chooseOption(defaultCard.querySelectorAll<HTMLButtonElement>('button')[1]!, '高');
    config = configOf({
      purposes: [
        purposeView('default', writerRef, { params: { thinking: 'low' } }),
        purposeView('narrator', null, { effectiveModel: writerRef }),
        purposeView('background', writerRef, { params: { thinking: 'low' } }),
      ],
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.llm });
    await waitFor(
      () => cardByName(container, '后台摘要')!.querySelectorAll<HTMLButtonElement>('button')[1]!.textContent === '低',
    );
    expect(fake.calls.filter((call) => call.path === 'llm.providers.list').length).toBeGreaterThan(1);
    expect(defaultCard.querySelectorAll<HTMLButtonElement>('button')[1]!.textContent).toBe('高');
    await unmount();
  });
});
