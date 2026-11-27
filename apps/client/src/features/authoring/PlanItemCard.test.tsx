import type { PlanItem } from '@unwritten/contracts';
import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { PlanItemCard } from './PlanItemCard.tsx';

initTestI18n();

const item: PlanItem = {
  id: 'item-summary',
  source: 'author_confirmed',
  kind: 'summary',
  key: 'tone',
  text: '安静，带一点悬疑。{{protagonist.名字}}每段停在一个决定点。',
};

function props(overrides: { editing?: boolean } = {}) {
  return {
    item,
    knowerNames: [],
    editing: overrides.editing ?? false,
    onEdit: () => {},
    onCancel: () => {},
    onSave: () => {},
    onRemove: () => {},
  };
}

describe('PlanItemCard', () => {
  it('标出来源，占位符显示为标签', async () => {
    const screen = await render(
      <ul>
        <PlanItemCard {...props()} />
      </ul>,
    );
    await expect.element(screen.getByText('作者确认')).toBeVisible();
    expect(screen.container.textContent).not.toContain('{{');
    await screen.unmount();
  });

  it('编辑按钮带项目名', async () => {
    const screen = await render(
      <ul>
        <PlanItemCard {...props()} />
      </ul>,
    );
    await expect.element(screen.getByRole('button', { name: '修改「基调」' })).toBeVisible();
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const screen = await render(
      <ul>
        <PlanItemCard {...props()} />
      </ul>,
    );
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
