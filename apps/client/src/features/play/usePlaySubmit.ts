import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlayerActionInput } from '@unwritten/contracts';
import { useApi } from '../../shared/api/context.tsx';
import { queryKeys } from '../../shared/api/query.ts';
import type { ActiveRequest } from './useTurnVisibleSample.ts';

export function usePlaySubmit(input: { routeId: string; headTurnId: string | null }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const startedAt = useRef<number | null>(null);
  const activeRequest = useRef<ActiveRequest | null>(null);

  const invalidateRoute = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.route(input.routeId) });
  };

  const submit = useMutation({
    mutationFn: (action: PlayerActionInput) => {
      const requestId = crypto.randomUUID();
      startedAt.current = performance.now();
      activeRequest.current = { id: requestId, attempt: 1 };
      return api.play.submitAction({
        requestId,
        routeId: input.routeId,
        expectedHeadTurnId: input.headTurnId ?? '',
        action,
      });
    },
    onSuccess: invalidateRoute,
    onError: invalidateRoute,
  });

  const retry = useMutation({
    mutationFn: (failed: { requestId: string; attempts: number }) => {
      startedAt.current = performance.now();
      activeRequest.current = { id: failed.requestId, attempt: failed.attempts + 1 };
      return api.play.retry({ requestId: failed.requestId });
    },
    onSuccess: invalidateRoute,
    onError: invalidateRoute,
  });

  return { submit, retry, startedAt, activeRequest };
}
