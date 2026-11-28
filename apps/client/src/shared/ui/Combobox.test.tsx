import { useState } from 'react';
import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '../test/i18n.ts';
import { Combobox } from './Combobox.tsx';

initTestI18n();

const options = Array.from({ length: 150 }, (_, index) => ({ value: String(index), label: `第${index + 1}章 潮声` }));

function Harness() {
  const [value, setValue] = useState('0');
  return (
    <>
      <Combobox label='原作起点' value={value} onValueChange={setValue} options={options} />
      <output>{value}</output>
    </>
  );
}

describe('Combobox', () => {
  it('展开时最多列出 100 项，输入后按名称过滤并选中', async () => {
    const screen = await render(<Harness />);
    const input = screen.getByRole('combobox', { name: '原作起点' });
    await expect.element(input).toHaveValue('第1章 潮声');
    await input.click();
    await expect.poll(() => document.querySelectorAll('[role="option"]').length).toBe(100);
    await input.fill('第120章');
    await expect.poll(() => document.querySelectorAll('[role="option"]').length).toBe(1);
    await screen.getByRole('option', { name: '第120章 潮声' }).click();
    await expect.poll(() => screen.container.querySelector('output')?.textContent).toBe('119');
    await screen.unmount();
  });

  it('没有匹配项时说明', async () => {
    const screen = await render(<Harness />);
    const input = screen.getByRole('combobox', { name: '原作起点' });
    await input.click();
    await input.fill('灯塔');
    await expect.element(screen.getByText('没有匹配的项')).toBeVisible();
    await screen.unmount();
  });
});
