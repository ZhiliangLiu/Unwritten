import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

export const queryKeys = {
  works: ['works'] as const,
  work: (workId: string) => ['work', workId] as const,
  novelChapters: (workId: string) => ['novelChapters', workId] as const,
  route: (routeId: string) => ['route', routeId] as const,
  llm: ['llm'] as const,
  llmLogs: ['llmLogs'] as const,
  llmLog: (callId: string) => ['llmLog', callId] as const,
  settings: ['settings'] as const,
  journal: (routeId: string) => ['journal', routeId] as const,
  journals: ['journal'] as const,
  startInfo: (workId: string) => ['startInfo', workId] as const,
  imageConfig: ['image', 'config'] as const,
  imageOutput: ['image', 'output'] as const,
  autoIllustration: ['image', 'auto'] as const,
  imageUsage: ['image', 'usage'] as const,
  imageStorage: ['image', 'storage'] as const,
  portraits: (workId: string) => ['portrait', workId] as const,
  portraitDraft: (workId: string, scope: string, target: string, appearance = '') =>
    ['portrait', workId, 'draft', scope, target, appearance] as const,
  portraitSet: (workId: string, setId: string) => ['portrait', workId, 'set', setId] as const,
  playthrough: (playthroughId: string) => ['playthrough', playthroughId] as const,
  playthroughs: (workId: string) => ['playthroughs', workId] as const,
  playthroughsAll: ['playthroughs'] as const,
  status: (routeId: string) => ['status', routeId] as const,
};
