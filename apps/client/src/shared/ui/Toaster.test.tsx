import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useNotify } from './Toaster.tsx';

function Trigger() {
  const notify = useNotify();
  return (
    <button type='button' onClick={() => notify({ title: '作品已删除', tone: 'success' })}>
      通知
    </button>
  );
}

describe('Toaster', () => {
  it('通知带图标和文字', async () => {
    const { container } = await render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    (container.querySelector('button') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const toast = document.body.querySelector('[data-type="success"]');
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain('作品已删除');
    expect(toast?.querySelector('svg')).not.toBeNull();
  });
});
