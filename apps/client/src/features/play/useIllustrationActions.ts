import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OutputPreferences } from '@unwritten/contracts';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';

export function useIllustrationActions(routeId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.route(routeId) });

  const retry = useMutation({
    mutationFn: (input: { illustrationId: string; format?: OutputPreferences | null }) =>
      api.illustration.retry({
        requestId: crypto.randomUUID(),
        illustrationId: input.illustrationId,
        format: input.format ?? null,
      }),
    onSuccess: invalidate,
  });

  const reroll = useMutation({
    mutationFn: (illustrationId: string) =>
      api.illustration.reroll({
        requestId: crypto.randomUUID(),
        illustrationId,
        format: null,
      }),
    onSuccess: invalidate,
  });

  const dismiss = useMutation({
    mutationFn: (illustrationId: string) =>
      api.illustration.dismiss({
        requestId: crypto.randomUUID(),
        illustrationId,
      }),
    onSuccess: invalidate,
  });

  return {
    retry,
    reroll,
    dismiss,
    pending: retry.isPending || reroll.isPending || dismiss.isPending,
  };
}

export type IllustrationActions = ReturnType<typeof useIllustrationActions>;
