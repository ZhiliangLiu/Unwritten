import type { PlaythroughView } from '@unwritten/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../../shared/test/fake-api.ts';
import type { FakeApiCall } from '../../shared/test/fake-api.ts';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { renderRoute } from '../../shared/test/render.tsx';

const workId = '6a5b4c3d-2e1f-4a9b-8c7d-6e5f4a3b2c1d';
const playthroughId = '8b2e6f4a-1c3d-4e5f-9a7b-2d4c6e8f0a1b';
const requestId = '4c1a7e9d-3b5f-4a2c-8d6e-0f1b3a5c7e9d';
const routeId = '2f1d5c4a-8b7e-4a3f-9c2d-1e0f9a8b7c6d';

function playthrough(overrides: Partial<PlaythroughView> = {}): PlaythroughView {
  return {
    id: playthroughId,
    workId,
    workTitle: '灯塔镇',
    routeId: null,
    opening: { id: requestId, status: 'running', error: null, attempts: 1, updatedAt: 1 },
    ...overrides,
  };
}

function requests(calls: FakeApiCall[], path: string): unknown[] {
  return calls.filter((call) => call.path === path).map((call) => call.input);
}

describe('OpeningPendingPage', () => {
  it('失败时可以重试这次开局', async () => {
    let current = playthrough({
      opening: { id: requestId, status: 'failed', error: 'network', attempts: 1, updatedAt: 1 },
    });
    const fake = createFakeApi({
      'play.getPlaythrough': () => current,
      'play.retryOpening': () => {
        current = playthrough({
          opening: { id: requestId, status: 'running', error: null, attempts: 2, updatedAt: 2 },
        });
        return current;
      },
    });
    const screen = await renderRoute(`/playthroughs/${playthroughId}`, { api: fake.api });

    await expect.element(screen.getByRole('heading', { name: '这一局的开场没有生成成功' })).toBeVisible();
    await screen.getByRole('button', { name: '重试这次开局' }).click();

    await vi.waitFor(() => expect(requests(fake.calls, 'play.retryOpening')).toEqual([{ requestId }]));
    await expect.element(screen.getByRole('heading', { name: '正在为这一局准备人物和开场' })).toBeVisible();
    await screen.unmount();
  });

  it('完成后进入游玩页', async () => {
    const fake = createFakeApi({
      'play.getPlaythrough': () => playthrough({ routeId }),
      'play.getRoute': () => undefined,
    });
    const screen = await renderRoute(`/playthroughs/${playthroughId}`, { api: fake.api });

    await vi.waitFor(() => expect(screen.router.state.location.pathname).toBe(`/play/${routeId}`));
    await screen.unmount();
  });

  it('无可访问性违规', async () => {
    const fake = createFakeApi({ 'play.getPlaythrough': () => playthrough() });
    const screen = await renderRoute(`/playthroughs/${playthroughId}`, { api: fake.api });

    await expect.element(screen.getByRole('heading', { name: '正在为这一局准备人物和开场' })).toBeVisible();
    await expect
      .element(screen.getByText('主要人物每局都不一样。可以离开这一页，生成完成后从作品库继续。'))
      .toBeVisible();
    await expectNoAxeViolations(document.body);
    await screen.unmount();
  });
});
