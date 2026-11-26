import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { Button, buttonClassName } from './Button.tsx';

describe('Button', () => {
  it('忙碌时禁用并标记 aria-busy', async () => {
    const { container } = await render(
      <Button variant='primary' busy>
        保存
      </Button>,
    );
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
  });

  it('buttonClassName 给链接同样的样式', async () => {
    const { container } = await render(
      <>
        <Button variant='secondary'>按钮</Button>
        <a className={buttonClassName('secondary')} href='#test'>
          链接
        </a>
      </>,
    );
    const button = container.querySelector('button');
    const link = container.querySelector('a');
    expect(button?.className).toBe(link?.className);
    expect(button?.className).not.toBe('');
  });
});
