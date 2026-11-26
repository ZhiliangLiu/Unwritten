import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField.tsx';

describe('TextField', () => {
  it('标签和输入框关联', async () => {
    const { container } = await render(<TextField label='端点地址' value='' onValueChange={() => {}} />);
    const label = container.querySelector('label');
    const input = container.querySelector('input');
    expect(label?.htmlFor).toBeTruthy();
    expect(label?.htmlFor).toBe(input?.id);
  });

  it('错误信息通过 aria-describedby 关联', async () => {
    const { container } = await render(
      <TextField label='端点地址' value='' onValueChange={() => {}} error='请填写地址' />,
    );
    const input = container.querySelector('input');
    const describedBy = input?.getAttribute('aria-describedby')?.split(' ') ?? [];
    const error = Array.from(container.querySelectorAll('[id]')).find((element) =>
      element.textContent?.includes('请填写地址'),
    );
    expect(describedBy.length).toBeGreaterThan(0);
    expect(error).toBeDefined();
    expect(describedBy).toContain(error!.id);
  });
});
