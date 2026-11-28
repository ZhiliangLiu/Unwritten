import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render } from 'vitest-browser-react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../shared/test/axe.ts';
import { initTestI18n } from '../../shared/test/i18n.ts';
import { EndedPanel } from './EndedPanel.tsx';

initTestI18n();

const workId = '6a5b4c3d-2e1f-4a9b-8c7d-6e5f4a3b2c1d';

describe('EndedPanel', () => {
  it('无可访问性违规', async () => {
    const root = createRootRoute();
    const index = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => (
        <main>
          <EndedPanel workId={workId} />
        </main>
      ),
    });
    const start = createRoute({
      getParentRoute: () => root,
      path: '/works/$workId/start',
      component: () => null,
    });
    const playthroughs = createRoute({
      getParentRoute: () => root,
      path: '/works/$workId/playthroughs',
      component: () => null,
    });
    const router = createRouter({
      routeTree: root.addChildren([index, start, playthroughs]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    await router.load();
    const screen = await render(<RouterProvider router={router} />);
    await expectNoAxeViolations(document.body);
    expect(screen.getByRole('link', { name: '重新开局' }).element()).toBeTruthy();
    expect(screen.getByRole('link', { name: '所有开局' }).element().getAttribute('href')).toBe(
      `/works/${workId}/playthroughs`,
    );
    await screen.unmount();
  });
});
