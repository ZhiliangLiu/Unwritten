import { describe, expect, it } from 'vitest';
import { DEFAULT_WORK_SETTINGS, EMPTY_WORK_ANCHORS } from '@unwritten/contracts';
import type { PlaythroughListItem, WorkDetail } from '@unwritten/contracts';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import { renderRoute } from '../../shared/test/render.tsx';
import { expectHeadingOutline } from '../../shared/test/heading-outline.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';

const workId = crypto.randomUUID();

function detail(): WorkDetail {
  return {
    id: workId,
    title: '灯塔夜班',
    blurb: null,
    status: 'playable',
    draft: {
      contentRev: 1,
      background: '一段背景',
      anchors: EMPTY_WORK_ANCHORS,
      settings: DEFAULT_WORK_SETTINGS,
      wizardStep: 'background',
      plan: null,
    },
    latestPreviewJob: null,
    latestPlanJob: null,
    illustrationStyle: null,
  };
}

function item(overrides: Partial<PlaythroughListItem>): PlaythroughListItem {
  return {
    id: crypto.randomUUID(),
    routeId: crypto.randomUUID(),
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now() - 3_600_000,
    protagonistName: null,
    place: null,
    time: null,
    turnCount: 0,
    ended: false,
    ...overrides,
  };
}

async function renderPage(items: PlaythroughListItem[]) {
  const fake = createFakeApi({
    'works.get': () => detail(),
    'play.listPlaythroughs': () => items,
  });
  const screen = await renderRoute(`/works/${workId}/playthroughs`, { api: fake.api });
  await expect.element(screen.getByRole('heading', { name: '所有开局' })).toBeVisible();
  return { ...fake, screen };
}

describe('PlaythroughsPage', () => {
  it('列出各次开局，分别链接到路线或未完成的开场', async () => {
    const activeRoute = crypto.randomUUID();
    const endedRoute = crypto.randomUUID();
    const pendingId = crypto.randomUUID();
    const { screen } = await renderPage([
      item({ routeId: activeRoute, protagonistName: '阿岚', place: '码头', time: '夜里', turnCount: 3 }),
      item({
        routeId: endedRoute,
        protagonistName: '白露',
        place: '灯塔顶',
        time: '深夜',
        turnCount: 8,
        ended: true,
      }),
      item({ id: pendingId, routeId: null, protagonistName: null, turnCount: null }),
    ]);

    await expect.element(screen.getByRole('heading', { name: '灯塔夜班' })).toBeVisible();
    const active = screen.getByRole('link', { name: /阿岚/ });
    await expect.element(active).toHaveAttribute('href', `/play/${activeRoute}`);
    await expect.element(screen.getByText('进行中')).toBeVisible();
    await expect.element(screen.getByText(/码头 · 夜里 · 第 3 回合/)).toBeVisible();
    const ended = screen.getByRole('link', { name: /白露/ });
    await expect.element(ended).toHaveAttribute('href', `/play/${endedRoute}`);
    await expect.element(screen.getByText('已完结')).toBeVisible();
    const pending = screen.getByRole('link', { name: /开场未完成/ });
    await expect.element(pending).toHaveAttribute('href', `/playthroughs/${pendingId}`);
    const start = screen.getByRole('link', { name: '开始新的开局' });
    await expect.element(start).toHaveAttribute('href', `/works/${workId}/start`);

    expectHeadingOutline(screen.container);
    await expectNoAxeViolations(document.body);
    await screen.unmount();
  });

  it('没有开局时给出开始入口', async () => {
    const { screen } = await renderPage([]);

    await expect.element(screen.getByRole('heading', { name: '还没有开局' })).toBeVisible();
    const start = screen.getByRole('link', { name: '开始新的开局' });
    await expect.element(start).toHaveAttribute('href', `/works/${workId}/start`);

    expectHeadingOutline(screen.container);
    await expectNoAxeViolations(document.body);
    await screen.unmount();
  });
});
