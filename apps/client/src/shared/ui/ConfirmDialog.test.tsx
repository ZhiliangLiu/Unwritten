import { useState } from 'react';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { initTestI18n } from '../test/i18n.ts';
import { Button, buttonClassName } from './Button.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';

initTestI18n();

async function waitFor(check: () => boolean): Promise<void> {
  const startedAt = performance.now();
  while (!check() && performance.now() - startedAt < 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function Harness({ tone, onConfirm }: { tone: 'default' | 'danger'; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant='secondary' onClick={() => setOpen(true)}>
        删除作品
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title='删除这部作品？'
        description='作品和全部进度都会删除。'
        confirmLabel='删除'
        tone={tone}
        onConfirm={onConfirm}
      />
    </>
  );
}

describe('ConfirmDialog', () => {
  it('关闭后焦点回到触发按钮', async () => {
    const { container } = await render(<Harness tone='default' onConfirm={() => {}} />);
    const trigger = container.querySelector('button');
    trigger!.focus();
    trigger!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cancel = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '取消');
    expect(cancel).toBeDefined();
    cancel!.click();
    await waitFor(() => document.activeElement === trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it('危险确认按钮用实底样式', async () => {
    await render(<Harness tone='danger' onConfirm={() => {}} />);
    const trigger = document.querySelector('button') as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirm = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '删除');
    expect(confirm).toBeDefined();
    expect(confirm!.className).toBe(buttonClassName('danger-solid'));
  });

  it('确认时调用 onConfirm', async () => {
    const onConfirm = vi.fn();
    await render(<Harness tone='default' onConfirm={onConfirm} />);
    const trigger = document.querySelector('button') as HTMLButtonElement;
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const confirm = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '删除');
    confirm!.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
