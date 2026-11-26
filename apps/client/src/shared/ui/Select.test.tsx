import { useState } from 'react';
import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { Select } from './Select.tsx';

const options = [
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'high', label: '高' },
];

function Harness() {
  const [value, setValue] = useState('off');
  return (
    <>
      <Select label='思考' value={value} onValueChange={setValue} options={options} />
      <output>{value}</output>
    </>
  );
}

describe('Select', () => {
  it('键盘打开并选择', async () => {
    const { container } = await render(<Harness />);
    const trigger = container.querySelector('button');
    expect(trigger).not.toBeNull();
    trigger!.focus();
    trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(items).toHaveLength(options.length);
    items[0]!.focus();
    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = (document.activeElement as HTMLElement | null) ?? items[1]!;
    expect(second).toBe(items[1]);
    second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('output')?.textContent).toBe('low');
  });
});
