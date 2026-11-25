import { Link, Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LibraryPage } from '../features/library/LibraryPage.tsx';
import { AuthoringPage } from '../features/authoring/AuthoringPage.tsx';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';
import { PlayPage } from '../features/play/PlayPage.tsx';
import styles from './app.module.css';

function RootLayout() {
  const { t } = useTranslation();
  return (
    <div className={styles.shell}>
      <header className={styles.toolbar}>
        <strong className={styles.brand}>{t('common:app.name')}</strong>
        <nav className={styles.nav}>
          <Link className={styles.link} activeProps={{ className: styles.active }} to='/'>
            {t('common:nav.library')}
          </Link>
          <Link className={styles.link} activeProps={{ className: styles.active }} to='/settings'>
            {t('common:nav.settings')}
          </Link>
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
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

const routeTree = rootRoute.addChildren([indexRoute, settingsRoute, worksEditRoute, playRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
