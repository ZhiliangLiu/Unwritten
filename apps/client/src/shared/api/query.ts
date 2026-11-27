import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

export const queryKeys = {
  works: ['works'] as const,
  work: (workId: string) => ['work', workId] as const,
  route: (routeId: string) => ['route', routeId] as const,
  llm: ['llm'] as const,
  llmLogStatus: ['llmLogStatus'] as const,
  llmLogs: ['llmLogs'] as const,
  llmLog: (callId: string) => ['llmLog', callId] as const,
  settings: ['settings'] as const,
  journal: (routeId: string) => ['journal', routeId] as const,
  startInfo: (workId: string) => ['startInfo', workId] as const,
  playthrough: (playthroughId: string) => ['playthrough', playthroughId] as const,
  status: (routeId: string) => ['status', routeId] as const,
};
