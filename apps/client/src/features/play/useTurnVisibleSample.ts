import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { RouteView } from '@unwritten/contracts';
import type { ApiClient } from '../../shared/api/client.ts';
import { reportSample } from '../../shared/lib/log.ts';

export interface ActiveRequest {
  id: string;
  attempt: number;
}

export function useTurnVisibleSample(input: {
  api: ApiClient;
  route: RouteView | undefined;
  activeRequest: RefObject<ActiveRequest | null>;
  startedAt: RefObject<number | null>;
}): void {
  const { api, route, activeRequest, startedAt } = input;
  const reportedRequest = useRef<string | null>(null);

  useEffect(() => {
    const active = activeRequest.current;
    if (!active || !route || startedAt.current === null) return;
    const key = `${active.id}:${active.attempt}`;
    if (reportedRequest.current === key) return;
    const latest = route.turns.at(-1);
    if (latest?.originRequest?.id === active.id && latest.originRequest.attempt === active.attempt) {
      reportedRequest.current = key;
      reportSample(api, {
        metric: 'client.turn_visible',
        durationMs: performance.now() - startedAt.current,
        outcome: 'ok',
        workId: route.workId,
        requestId: active.id,
        attempt: active.attempt,
      });
    } else if (
      route.pending?.id === active.id &&
      route.pending.status === 'failed' &&
      route.pending.attempts === active.attempt
    ) {
      reportedRequest.current = key;
      reportSample(api, {
        metric: 'client.turn_visible',
        durationMs: performance.now() - startedAt.current,
        outcome: 'error',
        workId: route.workId,
        requestId: active.id,
        attempt: active.attempt,
      });
    }
  }, [activeRequest, api, route, route?.pending?.id, route?.pending?.status, startedAt]);
}
