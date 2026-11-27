import type { LlmLogDetail, LlmLogSummary } from '@unwritten/contracts';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import { expectHeadingOutline } from '../../shared/test/heading-outline.ts';
import { renderRoute } from '../../shared/test/render.tsx';

const callId = '00000000-0000-4000-8000-000000000001';
const createdAt = Date.UTC(2026, 10, 27, 12, 0, 0);

const summary: LlmLogSummary = {
  callId,
  purpose: 'narrator',
  workId: null,
  provider: 'test-endpoint',
  model: 'test-model',
  refKind: 'job',
  refId: 'job-1',
  status: 'ok',
  error: null,
  inputTokens: 120,
  outputTokens: 80,
  durationMs: 1_200,
  createdAt,
};

const detail: LlmLogDetail = {
  ...summary,
  system: '系统提示',
  prompt: '玩家行动',
  response: [{ type: 'toolCall', id: 'call-1', name: 'propose_turn', arguments: { prose: '雨声' } }],
  http: [
    {
      seq: 1,
      method: 'POST',
      url: 'http://127.0.0.1:1/v1/chat/completions',
      status: 200,
      requestBody: '{"model":"test-model"}',
      responseBody: 'data: {"choices":[]}',
      error: null,
    },
  ],
};

describe('LlmLogsPage', () => {
  it('没有记录时显示空状态', async () => {
    const fake = createFakeApi({ 'llm.logs.list': () => ({ items: [] }) });
    const screen = await renderRoute('/debug/llm', { api: fake.api });

    await expect.element(screen.getByRole('heading', { name: '模型调用日志', level: 1 })).toBeVisible();
    await expect.element(screen.getByText('还没有调用记录')).toBeVisible();
    expectHeadingOutline(screen.container);
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });

  it('点开一条日志后显示输入、回复和 HTTP', async () => {
    const fake = createFakeApi({
      'llm.logs.list': () => ({ items: [summary] }),
      'llm.logs.get': () => detail,
    });
    const screen = await renderRoute('/debug/llm', { api: fake.api });

    const row = screen.getByRole('button', { name: /narrator/ });
    await expect.element(row).toBeVisible();
    await row.click();

    const dialog = screen.getByRole('dialog', { name: '调用详情' });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByText('系统提示')).toBeVisible();
    await expect.element(dialog.getByText('玩家行动')).toBeVisible();
    await expect.element(dialog.getByText('propose_turn')).toBeVisible();
    await dialog.getByText(/#1 POST 200/).click();
    await expect.element(dialog.getByText('{"model":"test-model"}')).toBeVisible();
    await expect.element(dialog.getByText('data: {"choices":[]}')).toBeVisible();
    expect(fake.calls.some((call) => call.path === 'llm.logs.get')).toBe(true);
    expectHeadingOutline(document.body);
    await expectNoAxeViolations(document.body);
    await screen.unmount();
  });
});
