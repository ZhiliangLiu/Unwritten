import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { render } from 'vitest-browser-react';
import { routeTree } from '../../app/router.tsx';
import { ApiProvider } from '../api/context.tsx';
import type { ApiClient } from '../api/client.ts';
import { ToastProvider } from '../ui/Toaster.tsx';
import { initTestI18n } from './i18n.ts';

export async function renderRoute(path: string, options: { api: ApiClient }) {
  initTestI18n();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  const result = await render(
    <ApiProvider value={options.api}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ApiProvider>,
  );
  return { ...result, router, queryClient };
}
