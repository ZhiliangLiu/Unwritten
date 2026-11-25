import type { ApiClient } from '../api/client.ts';

export type ClientSample =
  | { metric: 'client.library_ready'; durationMs: number; outcome: 'ok' | 'error' | 'interrupted' }
  | {
      metric: 'client.preview_visible';
      durationMs: number;
      outcome: 'ok' | 'error' | 'interrupted';
      workId?: string;
      jobId: string;
    }
  | {
      metric: 'client.turn_visible';
      durationMs: number;
      outcome: 'ok' | 'error' | 'interrupted';
      workId?: string;
      requestId: string;
      attempt?: number;
    };

export function reportSample(api: ApiClient, sample: ClientSample): void {
  void api.log.client({ kind: 'sample', ...sample }).catch(() => {});
}

export function reportError(
  api: ApiClient,
  area: 'library' | 'authoring' | 'play' | 'settings' | 'app',
  code: string,
): void {
  void api.log.client({ kind: 'event', area, code: code as never }).catch(() => {});
}
