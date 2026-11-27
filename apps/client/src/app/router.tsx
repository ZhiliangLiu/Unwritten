import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, createRootRoute, createRoute, createRouter, useNavigate } from '@tanstack/react-router';
import { useApi } from '../shared/api/context.tsx';
import { reportError } from '../shared/lib/log.ts';
import { Button } from '../shared/ui/Button.tsx';
import { ErrorNotice } from '../shared/ui/ErrorNotice.tsx';
import { Page } from '../shared/ui/Page.tsx';
import { useShortcut } from '../shared/hooks/useShortcut.ts';
import { LibraryPage } from '../features/library/LibraryPage.tsx';
import { AuthoringPage } from '../features/authoring/AuthoringPage.tsx';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';
import { OpeningPendingPage } from '../features/play/OpeningPendingPage.tsx';
import { PlayPage } from '../features/play/PlayPage.tsx';
import { StartPage } from '../features/play/StartPage.tsx';
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
const workStartRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/works/$workId/start',
  component: function WorkStartRoute() {
    const { workId } = workStartRoute.useParams();
    return <StartPage workId={workId} />;
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
const playthroughRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/playthroughs/$playthroughId',
  component: function PlaythroughRoute() {
    const { playthroughId } = playthroughRoute.useParams();
    return <OpeningPendingPage playthroughId={playthroughId} />;
  },
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute,
  worksEditRoute,
  workStartRoute,
  playRoute,
  playthroughRoute,
]);

export const router = createRouter({
  routeTree,
  defaultErrorComponent: function RouteError({ error, reset }) {
    const { t } = useTranslation();
    const api = useApi();
    useEffect(() => reportError(api, 'render', 'client_runtime'), [api, error]);
    return (
      <Page title={t('common:error.pageHeading')} heading='content' toolbar={{ start: { kind: 'brand' } }} width='page'>
        <ErrorNotice
          code='client_runtime'
          action={
            <Button variant='secondary' onClick={reset}>
              {t('common:action.retry')}
            </Button>
          }
        />
      </Page>
    );
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
