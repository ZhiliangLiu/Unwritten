import type { ClientLogInput } from '@unwritten/contracts';
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
      metric: 'client.plan_visible';
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

type ClientError = Extract<ClientLogInput, { kind: 'event' }>;

export function reportError(api: ApiClient, area: ClientError['area'], code: ClientError['code']): void {
  void api.log.client({ kind: 'event', area, code }).catch(() => {});
}
