import { useState } from 'react';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe.ts';
import { RadioGroup } from './RadioGroup.tsx';

const OPTIONS = [
  { value: 'left', label: '甲' },
  { value: 'right', label: '乙' },
];

function Harness({ appearance }: { appearance: 'list' | 'segmented' }) {
  const [value, setValue] = useState('left');
  return (
    <>
      <button type='button'>之前</button>
      <RadioGroup label='选项' value={value} onValueChange={setValue} options={OPTIONS} appearance={appearance} />
    </>
  );
}

describe('RadioGroup', () => {
  it.each(['list', 'segmented'] as const)('%s 的每个选项都是带名字、能用键盘选中的单选项', async (appearance) => {
    const screen = await render(<Harness appearance={appearance} />);
    const group = screen.getByRole('radiogroup', { name: '选项' });
    await expect.element(group.getByRole('radio', { name: '甲' })).toBeChecked();

    await screen.getByRole('button', { name: '之前' }).click();
    await userEvent.keyboard('{Tab}');
    await expect.element(group.getByRole('radio', { name: '甲' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(group.getByRole('radio', { name: '乙' })).toBeChecked();

    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
