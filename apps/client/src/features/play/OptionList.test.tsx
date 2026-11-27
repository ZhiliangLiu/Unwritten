import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { OptionList } from './OptionList.tsx';

initTestI18n();

describe('OptionList', () => {
  it('提醒用 aria-describedby 关联', async () => {
    const screen = await render(
      <OptionList
        options={[
          { text: '请客人进来避雨', hint: '客人说过他只等到十二点' },
          { text: '先不碰怀表', hint: null },
        ]}
        shortcutsEnabled={false}
        onSelect={() => {}}
      />,
    );
    const withHint = screen.getByRole('button', { name: /请客人进来避雨/ }).element();
    const describedBy = withHint.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    const hint = document.getElementById(describedBy!);
    expect(hint?.textContent).toBe('提醒：客人说过他只等到十二点');
    expect(
      screen
        .getByRole('button', { name: /先不碰怀表/ })
        .element()
        .hasAttribute('aria-describedby'),
    ).toBe(false);
    await screen.unmount();
  });
});
