import { DEFAULT_WORK_SETTINGS, EMPTY_WORK_ANCHORS, PlanItemSchema } from '@unwritten/contracts';
import type { PlanConflict, PlanItem, WorkDetail } from '@unwritten/contracts';
import { render } from 'vitest-browser-react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { PlanPanel } from './PlanPanel.tsx';

initTestI18n();

const summaryItem: PlanItem = {
  id: 'item-summary',
  source: 'ai',
  kind: 'summary',
  key: 'identity',
  text: '刚到灯塔镇的邮差。',
};

const protagonist: PlanItem = {
  id: 'item-protagonist',
  source: 'author',
  kind: 'entity',
  entityKind: 'character',
  role: 'protagonist',
  name: '阿远',
  knownAs: null,
  profile: '二十出头，记性好。',
  appearance: null,
  slot: null,
};

const castItem: PlanItem = {
  id: 'item-cast',
  source: 'author',
  kind: 'entity',
  entityKind: 'character',
  role: 'cast',
  name: '林潮',
  knownAs: '守灯人',
  profile: '五十岁上下，话少。',
  appearance: null,
  slot: { role: '守灯人', encounter: '主角在灯塔门口遇见他。' },
};

const secretItem: PlanItem = {
  id: 'item-secret',
  source: 'author',
  kind: 'secret',
  title: '旧信的去向',
  statement: '上一任邮差留下的旧信藏在灯塔里。',
  subjectId: null,
  knowerIds: ['item-cast'],
  reveal: '主角拿到第三封旧信时。',
};

const endingItem: PlanItem = {
  id: 'item-ending',
  source: 'ai',
  kind: 'ending',
  text: '三封旧信都送到收件人手里。',
};

const stateItem: PlanItem = {
  id: 'item-state',
  source: 'author',
  kind: 'state',
  key: 'tide',
  label: '潮位',
  display: 'number',
  config: { min: 0, max: 10, unit: '米', stages: [] },
  hidden: false,
  reveal: '',
  initial: '3',
};

const conflict: PlanConflict = {
  first: '林潮从不离开灯塔。',
  second: '每年冬天，林潮都去城里住一个月。',
  impact: '冬天开局时，林潮是否在镇上会前后不一致。',
};

function workDetail(
  items: PlanItem[],
  options: { confirmed?: boolean; conflicts?: PlanConflict[]; stale?: boolean; castMode?: 'fixed' | 'per_run' } = {},
): WorkDetail {
  return {
    id: crypto.randomUUID(),
    title: null,
    blurb: null,
    status: 'draft',
    hasUnpublishedChanges: false,
    routeCount: 0,
    draft: {
      contentRev: 4,
      background: '海边小镇的灯塔。',
      anchors: EMPTY_WORK_ANCHORS,
      settings: options.castMode
        ? { ...DEFAULT_WORK_SETTINGS, cast: { ...DEFAULT_WORK_SETTINGS.cast, mode: options.castMode } }
        : DEFAULT_WORK_SETTINGS,
      wizardStep: 'plan',
      plan: { items, conflicts: options.conflicts ?? [], confirmed: options.confirmed ?? false },
    },
    latestPreviewJob: null,
    latestPlanJob: options.stale
      ? {
          id: 'job-stale',
          status: 'done',
          basedOnContentRev: 3,
          error: null,
          stale: true,
          updatedAt: Date.now(),
        }
      : null,
    illustrationStyle: null,
  };
}

function noopProps() {
  return {
    busy: false,
    onRegenerate: () => {},
    onAdoptStale: () => {},
    onUpdateItem: () => {},
    onRemoveItem: () => {},
    onConfirm: () => {},
  };
}

describe('PlanPanel', () => {
  it('来源用文字标出', async () => {
    const screen = await render(<PlanPanel work={workDetail([summaryItem])} {...noopProps()} />);
    await expect.element(screen.getByText('AI 补全')).toBeVisible();
    await screen.unmount();
  });

  it('秘密默认折叠', async () => {
    const screen = await render(<PlanPanel work={workDetail([secretItem])} {...noopProps()} />);
    await expect.element(screen.getByText('旧信的去向')).toBeVisible();
    expect(screen.getByText('真相：上一任邮差留下的旧信藏在灯塔里。').query()).toBeNull();
    const toggle = screen.getByRole('button', { name: '查看幕后设定' });
    await toggle.click();
    await expect.element(screen.getByText('真相：上一任邮差留下的旧信藏在灯塔里。')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: '收起幕后设定' })).toHaveAttribute('aria-expanded', 'true');
    await expect.element(screen.getByText('秘密 · 旧信的去向')).toBeVisible();
    await screen.unmount();
  });

  it('折叠时只列出秘密的标题', async () => {
    const screen = await render(<PlanPanel work={workDetail([secretItem])} {...noopProps()} />);
    await expect.element(screen.getByText('旧信的去向')).toBeVisible();
    expect(screen.getByText('真相：上一任邮差留下的旧信藏在灯塔里。').query()).toBeNull();
    expect(screen.getByRole('button', { name: '修改「秘密 · 旧信的去向」' }).query()).toBeNull();
    await screen.unmount();
  });

  it('主角不能删除', async () => {
    const screen = await render(<PlanPanel work={workDetail([protagonist, castItem])} {...noopProps()} />);
    await screen.getByRole('button', { name: '修改「阿远 · 主角」' }).click();
    expect(screen.getByRole('button', { name: '删除' }).query()).toBeNull();
    await screen.getByRole('button', { name: '取消' }).click();
    await screen.getByRole('button', { name: '修改「林潮 · 主要人物」' }).click();
    await expect.element(screen.getByRole('button', { name: '删除' })).toBeVisible();
    await screen.unmount();
  });

  it('请求进行中时显示生成标记', async () => {
    const screen = await render(<PlanPanel work={workDetail([summaryItem])} {...noopProps()} busy />);
    const markers = screen.getByText('正在生成故事方案');
    expect(markers.elements()).toHaveLength(2);
    await expect.element(markers.first()).toBeVisible();
    await screen.unmount();
  });

  it('生成期间改过草稿时给出两个选择', async () => {
    const onAdoptStale = vi.fn();
    const screen = await render(
      <PlanPanel work={workDetail([summaryItem], { stale: true })} {...noopProps()} onAdoptStale={onAdoptStale} />,
    );
    await screen.getByRole('button', { name: '仍然采用' }).click();
    expect(onAdoptStale).toHaveBeenCalledWith('job-stale');
    await screen.unmount();
  });

  it('冲突并列两段原话', async () => {
    const screen = await render(
      <PlanPanel work={workDetail([summaryItem], { conflicts: [conflict] })} {...noopProps()} />,
    );
    await expect.element(screen.getByText('林潮从不离开灯塔。')).toBeVisible();
    await expect.element(screen.getByText('每年冬天，林潮都去城里住一个月。')).toBeVisible();
    await expect.element(screen.getByText('第一条')).toBeVisible();
    await expect.element(screen.getByText('第二条')).toBeVisible();
    await expect.element(screen.getByText(`影响：${conflict.impact}`)).toBeVisible();
    await screen.unmount();
  });

  it('每局生成的主要人物不显示人物参考入口', async () => {
    const fixed = await render(<PlanPanel work={workDetail([castItem])} {...noopProps()} />);
    await expect.element(fixed.getByRole('button', { name: '人物参考' })).toBeVisible();
    await fixed.unmount();

    const perRun = await render(<PlanPanel work={workDetail([castItem], { castMode: 'per_run' })} {...noopProps()} />);
    expect(perRun.getByRole('button', { name: '人物参考' }).query()).toBeNull();
    await perRun.unmount();
  });

  it('人物表单能写形象，回车不换行', async () => {
    const onUpdateItem = vi.fn();
    const screen = await render(
      <PlanPanel work={workDetail([castItem])} {...noopProps()} onUpdateItem={onUpdateItem} />,
    );
    await screen.getByRole('button', { name: '修改「林潮 · 主要人物」' }).click();
    const field = screen.getByRole('textbox', { name: '形象' });
    await field.fill('短卷发，左眉有一道浅缺口');
    await userEvent.keyboard('{Enter}');
    expect((field.element() as HTMLTextAreaElement).value).toBe('短卷发，左眉有一道浅缺口');
    await screen.getByRole('button', { name: '保存' }).click();
    const saved = onUpdateItem.mock.calls[0]?.[0] as PlanItem;
    expect(saved.kind === 'entity' ? saved.appearance : null).toBe('短卷发，左眉有一道浅缺口');
    await screen.unmount();
  });

  it('编辑后交给 onSave 的项通过契约校验', async () => {
    const onUpdateItem = vi.fn();
    const screen = await render(
      <PlanPanel work={workDetail([stateItem])} {...noopProps()} onUpdateItem={onUpdateItem} />,
    );
    await screen.getByRole('button', { name: '修改「潮位 · 数字」' }).click();
    await screen.getByRole('textbox', { name: '栏目名' }).fill('水位');
    await screen.getByRole('button', { name: '保存' }).click();
    expect(onUpdateItem).toHaveBeenCalledTimes(1);
    const saved = onUpdateItem.mock.calls[0]?.[0] as PlanItem;
    expect(PlanItemSchema.safeParse(saved).success).toBe(true);
    expect(saved.kind === 'state' ? saved.label : null).toBe('水位');
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const screen = await render(
      <PlanPanel
        work={workDetail([summaryItem, protagonist, castItem, stateItem, secretItem, endingItem], {
          conflicts: [conflict],
        })}
        {...noopProps()}
      />,
    );
    await screen.getByRole('button', { name: '查看幕后设定' }).click();
    await screen.getByRole('button', { name: '修改「潮位 · 数字」' }).click();
    await expectNoAxeViolations(screen.container);
    await screen.unmount();
  });
});
