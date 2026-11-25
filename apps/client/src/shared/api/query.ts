import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

export const queryKeys = {
  works: ["works"] as const,
  work: (workId: string) => ["work", workId] as const,
  route: (routeId: string) => ["route", routeId] as const,
  llm: ["llm"] as const,
};
