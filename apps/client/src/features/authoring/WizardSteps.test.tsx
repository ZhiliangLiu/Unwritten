import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { WizardSteps } from './WizardSteps.tsx';

initTestI18n();

const allAvailable = { background: true, plan: true, opening: true };

describe('WizardSteps', () => {
  it('标出当前步骤，点击其他步骤时通知调用方', async () => {
    const onSelect = vi.fn();
    const screen = await render(<WizardSteps current='plan' available={allAvailable} onSelect={onSelect} />);
    await expect.element(screen.getByRole('button', { name: '方案' })).toHaveAttribute('aria-current', 'step');
    await expect.element(screen.getByRole('button', { name: '背景' })).not.toHaveAttribute('aria-current');
    await screen.getByRole('button', { name: '开场' }).click();
    expect(onSelect).toHaveBeenCalledWith('opening');
    await screen.unmount();
  });

  it('不可进入的步骤禁用', async () => {
    const onSelect = vi.fn();
    const screen = await render(
      <WizardSteps
        current='background'
        available={{ background: true, plan: false, opening: false }}
        onSelect={onSelect}
      />,
    );
    await expect.element(screen.getByRole('button', { name: '背景' })).toBeEnabled();
    await expect.element(screen.getByRole('button', { name: '方案' })).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: '开场' })).toBeDisabled();
    (screen.getByRole('button', { name: '方案' }).element() as HTMLButtonElement).click();
    expect(onSelect).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const screen = await render(<WizardSteps current='background' available={allAvailable} onSelect={() => {}} />);
    await expectNoAxeViolations(document.body);
    await screen.unmount();
  });
});
