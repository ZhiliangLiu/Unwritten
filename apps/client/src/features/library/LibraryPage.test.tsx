import { describe, expect, it, vi } from 'vitest';
import { EMPTY_WORK_ANCHORS } from '@unwritten/contracts';
import type { WorkDetail, WorkSummary } from '@unwritten/contracts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import type { FakeApiCall } from '../../shared/test/fake-api.ts';
import { renderRoute } from '../../shared/test/render.tsx';
import { expectHeadingOutline } from '../../shared/test/heading-outline.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { buttonClassName } from '../../shared/ui/Button.tsx';

function summary(overrides: Partial<WorkSummary>): WorkSummary {
  return {
    id: crypto.randomUUID(),
    title: null,
    blurb: null,
    label: '一段背景',
    status: 'draft',
    hasProgress: false,
    routeId: null,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function detail(): WorkDetail {
  return {
    id: crypto.randomUUID(),
    title: null,
    blurb: null,
    status: 'draft',
    routeId: null,
    draft: { contentRev: 1, background: '一段背景', anchors: EMPTY_WORK_ANCHORS },
    latestPreviewJob: null,
  };
}

async function renderLibrary(list: WorkSummary[]) {
  const fake = createFakeApi({
    'works.list': () => list,
    'works.create': () => detail(),
    'works.delete': () => ({}),
  });
  const screen = await renderRoute('/', { api: fake.api });
  await expect.element(screen.getByRole('heading', { name: '作品库' })).toBeVisible();
  return { ...fake, screen };
}

function hasPath(calls: FakeApiCall[], path: string): FakeApiCall | undefined {
  return calls.find((call) => call.path === path);
}

describe('LibraryPage', () => {
  it('无可访问性违规', async () => {
    const { screen } = await renderLibrary([
      summary({ title: '末班渡轮', blurb: '最后一班船开走了。' }),
      summary({ title: '灯塔夜班', status: 'playable', routeId: crypto.randomUUID() }),
    ]);
    await expect.element(screen.getByRole('link', { name: '继续创作' })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: '设置' })).toBeVisible();
    await expectNoAxeViolations(document.body);
    await screen.unmount();
  });

  it('标题大纲正确', async () => {
    const { screen } = await renderLibrary([
      summary({ title: '末班渡轮' }),
      summary({ title: '灯塔夜班', status: 'playable', routeId: crypto.randomUUID() }),
    ]);
    await expect.element(screen.getByRole('link', { name: '继续创作' })).toBeVisible();
    await expect.element(screen.getByText('2 部作品，都保存在这台电脑上')).toBeVisible();
    expectHeadingOutline(screen.container);
    await screen.unmount();
  });

  it('空库时引导新建', async () => {
    const { screen } = await renderLibrary([]);
    await expect.element(screen.getByRole('heading', { name: '还没有作品' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: '新建故事' }).first()).toBeVisible();
    await screen.unmount();
  });

  it('每张卡只有一个主入口', async () => {
    const { screen } = await renderLibrary([
      summary({ title: '末班渡轮' }),
      summary({ title: '灯塔夜班', status: 'playable', routeId: crypto.randomUUID() }),
      summary({ title: '候船厅', status: 'playable', hasProgress: true, routeId: crypto.randomUUID() }),
    ]);
    await vi.waitFor(() => {
      expect(screen.container.querySelectorAll('article').length).toBe(3);
    });
    for (const article of screen.container.querySelectorAll('article')) {
      const entries = Array.from(article.querySelectorAll('a')).filter(
        (link) => link.className === buttonClassName('secondary'),
      );
      expect(entries.length).toBe(1);
    }
    await screen.unmount();
  });

  it('三种状态对应三种入口文字', async () => {
    const { screen } = await renderLibrary([
      summary({ title: '末班渡轮' }),
      summary({ title: '灯塔夜班', status: 'playable', routeId: crypto.randomUUID() }),
      summary({ title: '候船厅', status: 'playable', hasProgress: true, routeId: crypto.randomUUID() }),
    ]);
    await expect.element(screen.getByRole('link', { name: '继续创作' })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: '开始故事' })).toBeVisible();
    await expect.element(screen.getByRole('link', { name: '继续游玩' })).toBeVisible();
    await screen.unmount();
  });

  it('删除作品前确认，确认后调用删除并提示', async () => {
    const work = summary({ title: '末班渡轮' });
    const { screen, calls } = await renderLibrary([work]);
    await screen.getByRole('button', { name: '《末班渡轮》的更多操作' }).click();
    await screen.getByRole('menuitem', { name: '删除作品' }).click();
    await expect.element(screen.getByRole('alertdialog')).toBeVisible();
    await screen.getByRole('button', { name: '删除作品' }).click();
    await vi.waitFor(() => {
      expect(hasPath(calls, 'works.delete')?.input).toEqual({ workId: work.id });
    });
    await expect.element(screen.getByText('作品已删除')).toBeVisible();
    await screen.unmount();
  });

  it('取消删除不调用接口', async () => {
    const { screen, calls } = await renderLibrary([summary({ title: '末班渡轮' })]);
    await screen.getByRole('button', { name: '《末班渡轮》的更多操作' }).click();
    await screen.getByRole('menuitem', { name: '删除作品' }).click();
    await screen.getByRole('button', { name: '取消' }).click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hasPath(calls, 'works.delete')).toBeUndefined();
    await screen.unmount();
  });
});
