import { useState } from 'react';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { SideSheet } from './SideSheet.tsx';

function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <SideSheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
      title='手记'
    >
      <p>只有这一页知道的内容</p>
    </SideSheet>
  );
}

describe('SideSheet', () => {
  it('关闭时不渲染内容', async () => {
    await render(
      <SideSheet open={false} onOpenChange={() => {}} title='手记'>
        <p>只有这一页知道的内容</p>
      </SideSheet>,
    );
    expect(document.body.textContent).not.toContain('只有这一页知道的内容');
  });

  it('Esc 关闭', async () => {
    const onOpenChange = vi.fn();
    await render(<Harness onOpenChange={onOpenChange} />);
    expect(document.body.textContent).toContain('只有这一页知道的内容');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
