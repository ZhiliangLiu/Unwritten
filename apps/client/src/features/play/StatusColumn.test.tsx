import type { StatusColumnView } from '@unwritten/contracts';
import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { StatusColumn } from './StatusColumn.tsx';

initTestI18n();

function column(value: StatusColumnView['value'], overrides: Partial<StatusColumnView> = {}): StatusColumnView {
  return {
    id: crypto.randomUUID(),
    label: '备用钥匙',
    isNew: false,
    changed: false,
    value,
    history: [],
    ...overrides,
  };
}

async function renderColumn(value: StatusColumnView['value'], overrides: Partial<StatusColumnView> = {}) {
  const item = column(value, overrides);
  const screen = await render(
    <dl>
      <StatusColumn column={item} onJumpToTurn={() => {}} />
    </dl>,
  );
  return { screen, item };
}

describe('StatusColumn', () => {
  it('数字栏目给出进度条的可读数值', async () => {
    const { screen } = await renderColumn({
      display: 'number',
      value: 3,
      min: 0,
      max: 10,
      unit: null,
      previous: null,
    });
    const meter = screen.getByRole('meter', { name: '备用钥匙' });
    await expect.element(meter).toBeVisible();
    expect(meter.element().getAttribute('aria-valuenow')).toBe('3');
    expect(meter.element().getAttribute('aria-valuemin')).toBe('0');
    expect(meter.element().getAttribute('aria-valuemax')).toBe('10');
    await screen.unmount();
  });

  it('阶段栏目只写当前阶段名', async () => {
    const { screen } = await renderColumn({
      display: 'stage',
      stage: '素不相识',
      step: 2,
      total: 4,
      previousStep: null,
    });
    expect(screen.container.textContent).toContain('素不相识');
    expect(screen.container.textContent).toContain('第 2 步，共 4 步');
    expect(screen.container.textContent).not.toContain('告白');
    await screen.unmount();
  });

  it('变化用文字标出', async () => {
    const { screen } = await renderColumn({
      display: 'number',
      value: 3,
      min: null,
      max: null,
      unit: null,
      previous: 5,
    });
    expect(screen.container.textContent).toContain('−2');
    await screen.unmount();
  });

  it('清单状态不只靠图标', async () => {
    const { screen } = await renderColumn({
      display: 'list',
      items: [
        { item: '修好镇长家的座钟', status: 'done', change: null },
        { item: '弄清怀表为什么停住', status: 'open', change: 'new' },
      ],
    });
    expect(screen.container.textContent).toContain('已完成');
    expect(screen.container.textContent).toContain('进行中');
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const { screen } = await renderColumn({
      display: 'stage',
      stage: '素不相识',
      step: 2,
      total: 4,
      previousStep: 1,
    });
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
