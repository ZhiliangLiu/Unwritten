import { useState } from 'react';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ILLUSTRATION_STYLE } from '@unwritten/contracts';
import type { IllustrationStyle } from '@unwritten/contracts';
import { expectNoAxeViolations } from '../../test/axe.ts';
import { initTestI18n } from '../../test/i18n.ts';
import { StylePicker } from './StylePicker.tsx';

initTestI18n();

function Harness({
  initial = DEFAULT_ILLUSTRATION_STYLE,
  onChange,
  authorDefault,
}: {
  initial?: IllustrationStyle;
  onChange: (style: IllustrationStyle) => void;
  authorDefault?: IllustrationStyle;
}) {
  const [value, setValue] = useState(initial);
  return (
    <StylePicker
      value={value}
      authorDefault={authorDefault}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('StylePicker', () => {
  it('选预设后交给 onChange', async () => {
    const onChange = vi.fn();
    const screen = await render(<Harness onChange={onChange} />);
    await screen.getByText('水彩').click();
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'preset', preset: 'watercolor' });
    await screen.unmount();
  });

  it('选「自己写」出现单行输入，输入内容成为自定义画风', async () => {
    const onChange = vi.fn();
    const screen = await render(<Harness onChange={onChange} />);
    await screen.getByText('自己写').click();
    const field = screen.getByRole('textbox', { name: '自定义画风' });
    await field.fill('像旧照片的颗粒感');
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'custom', text: '像旧照片的颗粒感' });
    await screen.unmount();
  });

  it('传了作者默认时能恢复', async () => {
    const onChange = vi.fn();
    const authorDefault: IllustrationStyle = { kind: 'preset', preset: 'ink' };
    const screen = await render(
      <Harness initial={{ kind: 'custom', text: '铅笔线稿' }} onChange={onChange} authorDefault={authorDefault} />,
    );
    await screen.getByRole('button', { name: '恢复作者默认' }).click();
    expect(onChange).toHaveBeenLastCalledWith(authorDefault);
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const screen = await render(<Harness onChange={() => {}} />);
    await screen.getByText('自己写').click();
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
