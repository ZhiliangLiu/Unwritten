import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { initI18n, loadNamespace } from "../i18n/index.ts";
import { readToken } from "../shared/api/token.ts";
import { createApiClient } from "../shared/api/client.ts";
import { queryClient, queryKeys } from "../shared/api/query.ts";
import { ApiProvider } from "../shared/api/context.tsx";
import { applyAppearance, followSystemAppearance } from "../theme/appearance.ts";
import { router } from "./router.tsx";
import { NoTokenPage } from "./NoTokenPage.tsx";

export function App() {
  const [token] = useState(() => readToken());
  const [api] = useState(() => (token ? createApiClient(token) : null));

  useEffect(() => {
    applyAppearance("system");
    return followSystemAppearance();
  }, []);

  useEffect(() => {
    if (!api) return;
    for (const namespace of ["library", "authoring", "play", "settings"] as const) {
      void loadNamespace(namespace).then(() => queryClient.invalidateQueries());
    }
    let cancelled = false;
    const run = async () => {
      while (!cancelled) {
        try {
          const iterator = await api.events.subscribe();
          for await (const event of iterator) {
            if (event.type === "llm.config_changed") void queryClient.invalidateQueries({ queryKey: queryKeys.llm });
            if (event.type === "works.changed") {
              void queryClient.invalidateQueries({ queryKey: queryKeys.works });
              void queryClient.invalidateQueries({ queryKey: queryKeys.work(event.workId) });
            }
            if (event.type === "job.updated") void queryClient.invalidateQueries({ queryKey: queryKeys.work(event.workId) });
            if (event.type === "turn_request.updated" || event.type === "turn.committed") {
              void queryClient.invalidateQueries({ queryKey: queryKeys.route(event.routeId) });
              void queryClient.invalidateQueries({ queryKey: queryKeys.works });
            }
          }
        } catch {
          if (cancelled) return;
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (!token || !api) return <NoTokenPage />;
  return (
    <ApiProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiProvider>
  );
}

export async function bootstrap() {
  await initI18n();
  await Promise.all([loadNamespace("library"), loadNamespace("authoring"), loadNamespace("play"), loadNamespace("settings")]);
}
