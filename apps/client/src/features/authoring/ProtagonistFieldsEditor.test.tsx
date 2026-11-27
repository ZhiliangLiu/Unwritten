import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { PROTAGONIST_FIELDS_MAX } from '@unwritten/contracts';
import type { ProtagonistField } from '@unwritten/contracts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { ProtagonistFieldsEditor } from './ProtagonistFieldsEditor.tsx';

initTestI18n();

function fields(): ProtagonistField[] {
  return [
    { name: '名字', defaultValue: '阿远', isName: true },
    { name: '职业', defaultValue: '邮差', isName: false },
  ];
}

describe('ProtagonistFieldsEditor', () => {
  it('最多一项是主角名', async () => {
    const onChange = vi.fn();
    const screen = await render(<ProtagonistFieldsEditor fields={fields()} onChange={onChange} />);
    await screen.getByText('职业').click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual([
      { name: '名字', defaultValue: '阿远', isName: false },
      { name: '职业', defaultValue: '邮差', isName: true },
    ]);
    await screen.unmount();
  });

  it('名字不合规时不上报', async () => {
    const onChange = vi.fn();
    const screen = await render(<ProtagonistFieldsEditor fields={fields()} onChange={onChange} />);
    await screen.getByRole('textbox', { name: '项目名' }).first().fill('主角.名');
    expect(onChange).not.toHaveBeenCalled();
    await expect.element(screen.getByText('项目名不能含空格、句点或花括号')).toBeVisible();
    await screen.unmount();
  });

  it('重名时不上报并提示', async () => {
    const onChange = vi.fn();
    const screen = await render(<ProtagonistFieldsEditor fields={fields()} onChange={onChange} />);
    await screen.getByRole('textbox', { name: '项目名' }).nth(1).fill('名字');
    expect(onChange).not.toHaveBeenCalled();
    await expect.element(screen.getByText('已经有同名的项目').first()).toBeVisible();
    await screen.unmount();
  });

  it('并排的填写项顶端对齐，移除按钮对齐输入框', async () => {
    const screen = await render(
      <ProtagonistFieldsEditor
        fields={[{ name: '主角.名', defaultValue: '阿远', isName: true }]}
        onChange={() => {}}
      />,
    );
    const nameLabel = screen.getByText('项目名').element().getBoundingClientRect();
    const valueLabel = screen.getByText('默认值').element().getBoundingClientRect();
    expect(Math.abs(nameLabel.top - valueLabel.top)).toBeLessThan(1);
    const nameControl = screen.getByRole('textbox', { name: '项目名' }).element().getBoundingClientRect();
    const valueControl = screen.getByRole('textbox', { name: '默认值' }).element().getBoundingClientRect();
    expect(Math.abs(nameControl.top - valueControl.top)).toBeLessThan(1);
    const remove = screen.getByRole('button', { name: '删除「主角.名」' }).element().getBoundingClientRect();
    expect(Math.abs((remove.top + remove.bottom) / 2 - (valueControl.top + valueControl.bottom) / 2)).toBeLessThan(1);
    await screen.unmount();
  });

  it('达到上限后不能再添加', async () => {
    const full: ProtagonistField[] = Array.from({ length: PROTAGONIST_FIELDS_MAX }, (_, index) => ({
      name: `项目${index + 1}`,
      defaultValue: `值${index + 1}`,
      isName: index === 0,
    }));
    const screen = await render(<ProtagonistFieldsEditor fields={full} onChange={() => {}} />);
    await expect.element(screen.getByRole('button', { name: '添加填写项' })).toBeDisabled();
    await expect.element(screen.getByText(`最多 ${PROTAGONIST_FIELDS_MAX} 项`)).toBeVisible();
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const screen = await render(<ProtagonistFieldsEditor fields={fields()} onChange={() => {}} />);
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
