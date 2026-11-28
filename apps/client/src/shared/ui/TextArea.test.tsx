import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import '../../theme/global.css';
import { TextArea } from './TextArea.tsx';

const COLUMN_WIDTH = 400;

describe('TextArea', () => {
  it('多行输入框和单行输入框一样不超出所在列', async () => {
    const column = document.createElement('div');
    column.style.inlineSize = `${COLUMN_WIDTH}px`;
    document.body.append(column);
    const screen = await render(<TextArea label='行动' value='' onValueChange={() => {}} />, { container: column });
    const textarea = screen.getByRole('textbox', { name: '行动' }).element() as HTMLTextAreaElement;
    expect(textarea.getBoundingClientRect().width).toBe(COLUMN_WIDTH);
    await screen.unmount();
    column.remove();
  });

  it('最少行数按内容区计算，内边距和边框另算', async () => {
    const screen = await render(<TextArea label='行动' value='' onValueChange={() => {}} minRows={3} />);
    const textarea = screen.getByRole('textbox', { name: '行动' }).element() as HTMLTextAreaElement;
    const style = getComputedStyle(textarea);
    const contentHeight =
      textarea.getBoundingClientRect().height -
      Number.parseFloat(style.paddingBlockStart) -
      Number.parseFloat(style.paddingBlockEnd) -
      Number.parseFloat(style.borderBlockStartWidth) -
      Number.parseFloat(style.borderBlockEndWidth);
    expect(contentHeight).toBeCloseTo(Number.parseFloat(style.lineHeight) * 3, 0);
    await screen.unmount();
  });
});
