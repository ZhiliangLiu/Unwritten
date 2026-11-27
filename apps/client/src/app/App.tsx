import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { initI18n, loadNamespace } from '../i18n/index.ts';
import { readToken } from '../shared/api/token.ts';
import { createApiClient } from '../shared/api/client.ts';
import { queryClient, queryKeys } from '../shared/api/query.ts';
import { errorCode } from '../shared/api/errors.ts';
import { reportError } from '../shared/lib/log.ts';
import { ApiProvider } from '../shared/api/context.tsx';
import { applyAppearance, followSystemAppearance } from '../theme/appearance.ts';
import { ToastProvider } from '../shared/ui/Toaster.tsx';
import { router } from './router.tsx';
import { NoTokenPage } from './NoTokenPage.tsx';

export function App() {
  const [token, setToken] = useState(() => readToken());
  const [initialApi] = useState(() => (token ? createApiClient(token, () => setToken(null)) : null));
  const api = token ? initialApi : null;

  useEffect(() => {
    return followSystemAppearance();
  }, []);

  useEffect(() => {
    if (!api) return;
    for (const namespace of ['library', 'authoring', 'play', 'settings'] as const) {
      void loadNamespace(namespace).then(() => queryClient.invalidateQueries());
    }
    const controller = new AbortController();
    const reportRuntimeError = () => reportError(api, 'app', 'client_runtime');
    window.addEventListener('error', reportRuntimeError);
    window.addEventListener('unhandledrejection', reportRuntimeError);
    let disconnectCode: 'interrupted' | 'core_unreachable' | null = null;
    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          const iterator = await api.events.subscribe({ signal: controller.signal });
          if (disconnectCode) {
            reportError(api, 'events', disconnectCode);
            disconnectCode = null;
          }
          await queryClient.invalidateQueries();
          for await (const event of iterator) {
            if (event.type === 'llm.config_changed') void queryClient.invalidateQueries({ queryKey: queryKeys.llm });
            if (event.type === 'works.changed') {
              void queryClient.invalidateQueries({ queryKey: queryKeys.works });
              void queryClient.invalidateQueries({ queryKey: queryKeys.work(event.workId) });
            }
            if (event.type === 'job.updated')
              void queryClient.invalidateQueries({ queryKey: queryKeys.work(event.workId) });
            if (event.type === 'turn_request.updated' || event.type === 'turn.committed') {
              void queryClient.invalidateQueries({ queryKey: queryKeys.route(event.routeId) });
              void queryClient.invalidateQueries({ queryKey: queryKeys.works });
            }
            if (event.type === 'turn.committed') {
              void queryClient.invalidateQueries({ queryKey: queryKeys.journal(event.routeId) });
              void queryClient.invalidateQueries({ queryKey: queryKeys.status(event.routeId) });
            }
            if (event.type === 'playthrough.updated') {
              void queryClient.invalidateQueries({ queryKey: queryKeys.playthrough(event.playthroughId) });
            }
            if (event.type === 'settings.changed') {
              applyAppearance(event.appearance);
              queryClient.setQueryData(queryKeys.settings, event.appearance);
            }
          }
          if (controller.signal.aborted) return;
          disconnectCode = 'interrupted';
          await queryClient.invalidateQueries();
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        } catch (error) {
          if (controller.signal.aborted) return;
          disconnectCode =
            errorCode(error) === 'core_unreachable' ? 'core_unreachable' : (disconnectCode ?? 'interrupted');
          await queryClient.invalidateQueries();
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
    };
    void run();
    return () => {
      controller.abort();
      window.removeEventListener('error', reportRuntimeError);
      window.removeEventListener('unhandledrejection', reportRuntimeError);
    };
  }, [api]);

  if (!api) return <NoTokenPage expired={initialApi !== null} />;
  return (
    <ApiProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ApiProvider>
  );
}

export async function bootstrap() {
  await initI18n();
  await Promise.all([
    loadNamespace('library'),
    loadNamespace('authoring'),
    loadNamespace('play'),
    loadNamespace('settings'),
  ]);
}
