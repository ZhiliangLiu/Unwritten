import { useState } from 'react';
import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '../test/i18n.ts';
import { expectHeadingOutline } from '../test/heading-outline.ts';
import { Page } from './Page.tsx';
import { PageToolbar } from './PageToolbar.tsx';

initTestI18n();

function PageHarness({ heading }: { heading: 'toolbar' | 'content' }) {
  const [title, setTitle] = useState('作品库');
  return (
    <>
      <button type='button' onClick={() => setTitle('设置')}>
        改标题
      </button>
      <Page title={title} heading={heading} toolbar={{ start: { kind: 'brand' } }} width='page'>
        <p>内容</p>
      </Page>
    </>
  );
}

describe('Page', () => {
  it('挂载时设置文档标题并聚焦 h1', async () => {
    const { container } = await render(<PageHarness heading='toolbar' />);
    const heading = container.querySelector('h1');
    expect(document.title).toBe('作品库 · Unwritten');
    expect(document.activeElement).toBe(heading);
    expectHeadingOutline(container);
  });

  it('标题变化不抢焦点', async () => {
    const { container } = await render(<PageHarness heading='toolbar' />);
    const button = container.querySelector('button') as HTMLButtonElement;
    button.focus();
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.title).toBe('设置 · Unwritten');
    expect(document.activeElement).toBe(button);
  });

  it('标题在内容区时工具行没有 h1', async () => {
    const { container } = await render(<PageHarness heading='content' />);
    expect(container.querySelector('header')?.querySelector('h1')).toBeNull();
    expect(container.querySelector('main header h1')).not.toBeNull();
  });

  it('标题在工具行时 h1 在 header 里', async () => {
    const { container } = await render(<PageHarness heading='toolbar' />);
    expect(container.querySelector('header')?.querySelector('h1')).not.toBeNull();
    expect(container.querySelector('main h1')).toBeNull();
  });

  it('工具行的标题不是标题元素时渲染为文字', async () => {
    const { container } = await render(<PageToolbar start={{ kind: 'brand' }} title='作品库' titleIsHeading={false} />);
    expect(container.querySelector('h1')).toBeNull();
    expect(container.textContent).toContain('作品库');
  });
});
