import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { StatusColumnView, StatusView } from '@unwritten/contracts';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../shared/api/context.tsx';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { StatusBar } from './StatusBar.tsx';

initTestI18n();

const routeId = '2f1d5c4a-8b7e-4a3f-9c2d-1e0f9a8b7c6d';

function column(
  id: string,
  label: string,
  value: StatusColumnView['value'],
  overrides: Partial<StatusColumnView> = {},
): StatusColumnView {
  return { id, label, isNew: false, changed: false, value, history: [], ...overrides };
}

function statusView(overrides: Partial<StatusView> = {}): StatusView {
  return { routeId, headTurnId: crypto.randomUUID(), columns: [], closed: [], ...overrides };
}

async function renderBar(view: StatusView, onJumpToTurn = vi.fn()) {
  const fake = createFakeApi({ 'play.getStatus': () => view });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <ApiProvider value={fake.api}>
      <QueryClientProvider client={queryClient}>
        <StatusBar routeId={routeId} onJumpToTurn={onJumpToTurn} />
      </QueryClientProvider>
    </ApiProvider>,
  );
  await vi.waitFor(() => expect(fake.calls.some((call) => call.path === 'play.getStatus')).toBe(true));
  return { screen, fake, onJumpToTurn };
}

describe('StatusBar', () => {
  it('没有栏目时不渲染', async () => {
    const { screen } = await renderBar(statusView());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.container.querySelector('section')).toBeNull();
    await screen.unmount();
  });

  it('已了结的栏目默认收起', async () => {
    const { screen } = await renderBar(
      statusView({
        closed: [column('closed-1', '镇长的口信', { display: 'text', value: '欠下的人情', previous: null })],
      }),
    );
    const toggle = screen.getByRole('button', { name: '已了结 1 项：镇长的口信' });
    await expect.element(toggle).toBeVisible();
    expect(toggle.element().getAttribute('aria-expanded')).toBe('false');
    expect(screen.container.querySelectorAll('dl')).toHaveLength(0);

    await toggle.click();
    await vi.waitFor(() => expect(toggle.element().getAttribute('aria-expanded')).toBe('true'));
    expect(screen.container.querySelectorAll('dl')).toHaveLength(1);
    expect(screen.container.textContent).toContain('欠下的人情');
    await screen.unmount();
  });

  it('来历能跳回回合', async () => {
    const { screen, onJumpToTurn } = await renderBar(
      statusView({
        columns: [
          column(
            'key',
            '备用钥匙',
            { display: 'text', value: '在阿栗手里', previous: null },
            {
              history: [
                { turnId: 'turn-a', depth: 3, text: '在阿栗手里' },
                { turnId: 'turn-b', depth: 0, text: '锁在抽屉最里面' },
              ],
            },
          ),
        ],
      }),
    );
    const trigger = screen.getByRole('button', { name: '备用钥匙的来历' });
    await expect.element(trigger).toBeVisible();
    expect(trigger.element().getAttribute('aria-expanded')).toBe('false');
    await trigger.click();
    await vi.waitFor(() => expect(trigger.element().getAttribute('aria-expanded')).toBe('true'));
    await vi.waitFor(() => expect(document.body.textContent).toContain('只列出这一栏显示以来的变化。'));
    expect(document.body.textContent).toContain('第 3 回合');
    expect(document.body.textContent).toContain('当前');

    const jumps = Array.from(document.querySelectorAll('button')).filter(
      (button) => button.textContent === '跳回这一回合',
    );
    await userEvent.click(jumps[0]!);
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('只列出这一栏显示以来的变化。'));
    expect(onJumpToTurn).toHaveBeenCalledWith('turn-a');
    await screen.unmount();
  });

  it('进行中的清单条目有可读的状态文字', async () => {
    const { screen } = await renderBar(
      statusView({
        columns: [
          column('errands', '今晚的事', {
            display: 'list',
            items: [{ item: '修好镇长家的座钟', status: 'open', change: null }],
          }),
        ],
      }),
    );
    await vi.waitFor(() => expect(screen.container.textContent).toContain('进行中'));
    expect(screen.getByText('进行中').element()).toBeTruthy();
    await screen.unmount();
  });

  it('按 Esc 关闭来历并把焦点还给栏目按钮', async () => {
    const { screen } = await renderBar(
      statusView({
        columns: [
          column(
            'key',
            '备用钥匙',
            { display: 'text', value: '在阿栗手里', previous: null },
            {
              history: [{ turnId: 'turn-a', depth: 0, text: '在阿栗手里' }],
            },
          ),
        ],
      }),
    );
    const trigger = screen.getByRole('button', { name: '备用钥匙的来历' });
    await trigger.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('只列出这一栏显示以来的变化。'));
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('只列出这一栏显示以来的变化。'));
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger.element()));
    await screen.unmount();
  });
});
