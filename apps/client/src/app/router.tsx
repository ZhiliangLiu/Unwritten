import { Outlet, createRootRoute, createRoute, createRouter, useNavigate } from '@tanstack/react-router';
import { useShortcut } from '../shared/hooks/useShortcut.ts';
import { LibraryPage } from '../features/library/LibraryPage.tsx';
import { AuthoringPage } from '../features/authoring/AuthoringPage.tsx';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';
import { PlayPage } from '../features/play/PlayPage.tsx';
import styles from './app.module.css';

function RootLayout() {
  const navigate = useNavigate();
  useShortcut({ key: ',', mod: true }, () => {
    void navigate({ to: '/settings' });
  });
  return (
    <div className={styles.shell}>
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: LibraryPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage });
const worksEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/works/$workId/edit',
  component: function WorksEditRoute() {
    const { workId } = worksEditRoute.useParams();
    return <AuthoringPage workId={workId} />;
  },
});
const playRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/play/$routeId',
  component: function PlayRoute() {
    const { routeId } = playRoute.useParams();
    return <PlayPage routeId={routeId} />;
  },
});

export const routeTree = rootRoute.addChildren([indexRoute, settingsRoute, worksEditRoute, playRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
