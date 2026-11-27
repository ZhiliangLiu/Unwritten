import { useRef, useState } from 'react';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORK_SETTINGS } from '@unwritten/contracts';
import type { WorkSettings } from '@unwritten/contracts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { SettingsSections } from './SettingsSections.tsx';

initTestI18n();

function Harness({ initial, onChange }: { initial: WorkSettings; onChange: (settings: WorkSettings) => void }) {
  const [settings, setSettings] = useState(initial);
  const openingTextRef = useRef<HTMLTextAreaElement>(null);
  return (
    <SettingsSections
      settings={settings}
      onChange={(next) => {
        onChange(next);
        setSettings(next);
      }}
      openingTextRef={openingTextRef}
    />
  );
}

describe('SettingsSections', () => {
  it('切换主要人物模式', async () => {
    const onChange = vi.fn();
    const screen = await render(<Harness initial={DEFAULT_WORK_SETTINGS} onChange={onChange} />);
    await screen.getByText('每次新开局生成').click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].cast.mode).toBe('per_run');
    await screen.unmount();
  });

  it('作者原文模式可以插入填写项', async () => {
    const initial: WorkSettings = {
      ...DEFAULT_WORK_SETTINGS,
      opening: { text: '第一幕：灯塔。', mode: 'author_text' },
      protagonist: {
        text: '',
        fields: [{ name: '名字', defaultValue: '阿远', isName: true }],
      },
    };
    const onChange = vi.fn();
    const screen = await render(<Harness initial={initial} onChange={onChange} />);
    const textarea = screen.getByRole('textbox', { name: '开场原文' }).element() as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(3, 3);
    await screen.getByRole('button', { name: '插入填写项' }).click();
    await screen.getByRole('menuitem', { name: '名字' }).click();
    const text = onChange.mock.calls[0]?.[0].opening.text as string;
    expect(text.slice(0, 3)).toBe('第一幕');
    expect(text.slice(3).startsWith('{{protagonist.名字}}')).toBe(true);
    await screen.unmount();
  });

  it('没有填写项时不显示插入菜单', async () => {
    const initial: WorkSettings = {
      ...DEFAULT_WORK_SETTINGS,
      opening: { text: '第一幕。', mode: 'author_text' },
    };
    const screen = await render(<Harness initial={initial} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '插入填写项' }).query()).toBeNull();
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const screen = await render(<Harness initial={DEFAULT_WORK_SETTINGS} onChange={() => {}} />);
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
