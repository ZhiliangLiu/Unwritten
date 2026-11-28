import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '../shared/test/i18n.ts';
import { NoTokenPage } from './NoTokenPage.tsx';

initTestI18n();

describe('NoTokenPage', () => {
  it('启动时就没有令牌：只设文档标题，不把焦点移到 h1', async () => {
    const { container, unmount } = await render(<NoTokenPage expired={false} />);
    const heading = container.querySelector('h1');
    expect(document.title).toContain(heading?.textContent ?? '');
    expect(document.activeElement).not.toBe(heading);
    await unmount();
  });

  it('使用中令牌失效：切到这一页时把焦点移到 h1', async () => {
    const { container, unmount } = await render(<NoTokenPage expired />);
    expect(document.activeElement).toBe(container.querySelector('h1'));
    await unmount();
  });
});
