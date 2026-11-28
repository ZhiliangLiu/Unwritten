import { BookOpen } from 'lucide-react';
import { render } from 'vitest-browser-react';
import type { ReactNode } from 'react';
import { describe, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe.ts';
import { initTestI18n } from '../test/i18n.ts';
import { Badge } from './Badge.tsx';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Combobox } from './Combobox.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { EmptyState } from './EmptyState.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import { GeneratingMarker } from './GeneratingMarker.tsx';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import { LiveRegion } from './LiveRegion.tsx';
import { Logo } from './Logo.tsx';
import { NumberField } from './NumberField.tsx';
import { OverflowMenu } from './OverflowMenu.tsx';
import { Page } from './Page.tsx';
import { PageToolbar } from './PageToolbar.tsx';
import { RadioGroup } from './RadioGroup.tsx';
import { Select } from './Select.tsx';
import { SideSheet } from './SideSheet.tsx';
import { Skeleton } from './Skeleton.tsx';
import { TextArea } from './TextArea.tsx';
import { TextField } from './TextField.tsx';
import { ToastProvider } from './Toaster.tsx';
import { VisuallyHidden } from './VisuallyHidden.tsx';

initTestI18n();

async function expectAccessible(ui: ReactNode, target: 'container' | 'body' = 'container') {
  const result = await render(ui);
  await expectNoAxeViolations(target === 'body' ? document.body : result.container);
  await result.unmount();
}

describe('无可访问性违规', () => {
  it('Button', async () => {
    await expectAccessible(
      <Button variant='primary' icon={BookOpen}>
        开始故事
      </Button>,
    );
  });

  it('IconButton', async () => {
    await expectAccessible(<IconButton label='更多操作' icon={BookOpen} />);
  });

  it('Icon', async () => {
    await expectAccessible(<Icon icon={BookOpen} />);
  });

  it('TextField', async () => {
    await expectAccessible(<TextField label='端点地址' value='' onValueChange={() => {}} description='只填地址' />);
  });

  it('TextArea', async () => {
    await expectAccessible(<TextArea label='故事背景' value='' onValueChange={() => {}} />);
  });

  it('NumberField', async () => {
    await expectAccessible(<NumberField label='思考预算' value={null} onValueChange={() => {}} />);
  });

  it('Combobox', async () => {
    await expectAccessible(
      <Combobox label='原作起点' value='0' onValueChange={() => {}} options={[{ value: '0', label: '第一章 归港' }]} />,
    );
  });

  it('Select', async () => {
    await expectAccessible(
      <Select label='思考' value='off' onValueChange={() => {}} options={[{ value: 'off', label: '关闭' }]} />,
    );
  });

  it('RadioGroup', async () => {
    await expectAccessible(
      <RadioGroup
        label='正文字体'
        value='serif'
        onValueChange={() => {}}
        options={[
          { value: 'serif', label: '衬线' },
          { value: 'sans', label: '无衬线' },
        ]}
      />,
    );
  });

  it('Card', async () => {
    await expectAccessible(
      <Card>
        <p>卡片内容</p>
      </Card>,
    );
  });

  it('Badge', async () => {
    await expectAccessible(<Badge tone='success'>已配置</Badge>);
  });

  it('PageToolbar', async () => {
    await expectAccessible(<PageToolbar start={{ kind: 'brand' }} title='作品库' titleIsHeading />);
  });

  it('Page', async () => {
    await expectAccessible(
      <Page title='作品库' heading='content' toolbar={{ start: { kind: 'brand' } }} width='page'>
        <p>内容</p>
      </Page>,
    );
  });

  it('ConfirmDialog', async () => {
    await expectAccessible(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title='删除作品？'
        description='无法恢复。'
        confirmLabel='删除'
        tone='danger'
        onConfirm={() => {}}
      />,
      'body',
    );
  });

  it('SideSheet', async () => {
    await expectAccessible(
      <SideSheet open onOpenChange={() => {}} title='手记'>
        <p>内容</p>
      </SideSheet>,
      'body',
    );
  });

  it('OverflowMenu', async () => {
    await expectAccessible(<OverflowMenu label='更多操作' items={[{ label: '删除作品', onSelect: () => {} }]} />);
  });

  it('ToastProvider', async () => {
    await expectAccessible(
      <ToastProvider>
        <p>应用内容</p>
      </ToastProvider>,
    );
  });

  it('Skeleton', async () => {
    await expectAccessible(<Skeleton variant='lines' count={3} />);
  });

  it('EmptyState', async () => {
    await expectAccessible(<EmptyState title='还没有作品' description='新建一部作品。' headingLevel={2} />);
  });

  it('GeneratingMarker', async () => {
    await expectAccessible(<GeneratingMarker label='正在生成' />);
  });

  it('VisuallyHidden', async () => {
    await expectAccessible(<VisuallyHidden>仅读屏可见</VisuallyHidden>);
  });

  it('LiveRegion', async () => {
    await expectAccessible(<LiveRegion message='已保存' />);
  });

  it('ErrorNotice', async () => {
    await expectAccessible(<ErrorNotice code='unknown' />);
  });

  it('Logo', async () => {
    await expectAccessible(<Logo variant='full' withWordmark />);
  });
});
