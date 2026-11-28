import { useState } from 'react';
import { render } from 'vitest-browser-react';
import { beforeEach, describe, expect, it } from 'vitest';
import { initTestI18n } from '../test/i18n.ts';
import { expectHeadingOutline } from '../test/heading-outline.ts';
import { Page, resetLaunchPageForTests } from './Page.tsx';
import { PageToolbar } from './PageToolbar.tsx';

initTestI18n();

function PageHarness({ heading, subtitle }: { heading: 'toolbar' | 'content' | 'custom'; subtitle?: string }) {
  const [title, setTitle] = useState('作品库');
  return (
    <>
      <button type='button' onClick={() => setTitle('设置')}>
        改标题
      </button>
      <Page title={title} heading={heading} subtitle={subtitle} toolbar={{ start: { kind: 'brand' } }} width='page'>
        {heading === 'custom' ? <h1 tabIndex={-1}>{title}</h1> : null}
        <p>内容</p>
      </Page>
    </>
  );
}

async function showLaunchPage(): Promise<void> {
  const launch = await render(<PageHarness heading='toolbar' />);
  await launch.unmount();
}

describe('Page', () => {
  beforeEach(() => {
    resetLaunchPageForTests();
  });

  it('启动后的第一页只设文档标题，不把焦点移到 h1', async () => {
    const { container } = await render(<PageHarness heading='toolbar' />);
    expect(document.title).toBe('作品库 · Unwritten');
    expect(document.activeElement).not.toBe(container.querySelector('h1'));
    expect(container.querySelector('h1')?.matches(':focus-visible')).toBe(false);
  });

  it('切换到新页面时设置文档标题并聚焦 h1', async () => {
    await showLaunchPage();
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

  it('标题由页面自己渲染时不再生成页头，并聚焦子元素的 h1', async () => {
    await showLaunchPage();
    const { container } = await render(<PageHarness heading='custom' subtitle='副标题' />);
    expect(container.querySelector('main > header')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('h1'));
    expect(container.textContent).not.toContain('副标题');
    expectHeadingOutline(container);
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
