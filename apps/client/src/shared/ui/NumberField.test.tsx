import { useState } from 'react';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { NumberField } from './NumberField.tsx';

function Harness({ onValueChange }: { onValueChange: (value: number | null) => void }) {
  const [value, setValue] = useState<number | null>(5);
  return (
    <NumberField
      label='思考预算'
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
    />
  );
}

describe('NumberField', () => {
  it('清空时回传 null', async () => {
    const onValueChange = vi.fn();
    const { container } = await render(<Harness onValueChange={onValueChange} />);
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') as
      Record<string, unknown> | undefined;
    const setter = descriptor?.['set'];
    if (typeof setter === 'function') Reflect.apply(setter, input, ['']);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onValueChange).toHaveBeenCalledWith(null);
  });
});
