import type { ErrorCode, ProbeResult } from '@unwritten/contracts';
import type { Logger } from '../log/logger.ts';
import { resolveApiKey } from '../providers/keys.ts';
import type { ImageServiceEntry } from '../providers/schema.ts';
import type { ProbeRecord } from './capability-cache.ts';
import { ImageError } from './errors.ts';
import { createUnwrittenImageClient } from './unwritten-client.ts';

export const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeCache {
  get(serviceId: string): ProbeRecord | null;
  set(serviceId: string, record: ProbeRecord): void;
  delete(serviceId: string): void;
}

export interface ProbeOutcome {
  record: ProbeRecord;
  error: ImageError | null;
}

export interface Prober {
  probe(entry: ImageServiceEntry, signal?: AbortSignal): Promise<ProbeOutcome | null>;
  offlineSince(serviceId: string): number | null;
}

export interface ProberDeps {
  cache: ProbeCache;
  logger: Logger;
  shutdown: AbortSignal;
  env: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export function notReadyCode(reason: string | null): ErrorCode {
  if (reason === 'out_of_memory') return 'image_out_of_memory';
  if (reason === 'workflow_error') return 'image_workflow_error';
  return 'image_not_ready';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function failureResult(error: unknown): { result: ProbeResult; error: ImageError } {
  if (error instanceof ImageError) {
    if (error.code === 'image_offline') return { result: 'offline', error };
    if (error.code === 'image_unauthorized') return { result: 'unauthorized', error };
    return { result: 'invalid', error };
  }
  return { result: 'invalid', error: new ImageError('image_invalid_response', 'final', { cause: error }) };
}

export function createProber(deps: ProberDeps): Prober {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;

  const log = (entry: ImageServiceEntry, record: ProbeRecord): void => {
    deps.logger.record({
      level: record.result === 'ready' ? 'debug' : 'info',
      module: 'image',
      event: 'image.service.probe',
      data: {
        serviceId: entry.id,
        protocol: entry.protocol,
        result: record.result,
        ...(record.notReadyReason === null ? {} : { reason: record.notReadyReason }),
      },
    });
  };

  const probe = async (entry: ImageServiceEntry, signal?: AbortSignal): Promise<ProbeOutcome | null> => {
    if (entry.protocol !== 'unwritten-image') return null;
    const at = now();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const signals = [deps.shutdown, timeout.signal];
    if (signal !== undefined) signals.push(signal);
    const combined = AbortSignal.any(signals);

    try {
      const client = createUnwrittenImageClient({
        baseUrl: entry.baseUrl,
        token: resolveApiKey(entry.apiKey, deps.env),
        fetch: deps.fetch,
      });
      const info = await client.info(combined);
      const record: ProbeRecord = {
        at,
        result: info.ready ? 'ready' : 'not_ready',
        notReadyReason: info.notReadyReason,
        implementation: info.implementation,
        model: info.model,
        capabilities: info.capabilities,
      };
      const error = info.ready ? null : new ImageError(notReadyCode(info.notReadyReason), 'final');
      deps.cache.set(entry.id, record);
      log(entry, record);
      return { record, error };
    } catch (error) {
      if (signal?.aborted === true || deps.shutdown.aborted) throw error;
      if (isAbortError(error) && !timeout.signal.aborted) throw error;
      const failure = timeout.signal.aborted
        ? { result: 'offline' as ProbeResult, error: new ImageError('image_offline', 'transport') }
        : failureResult(error);
      const record: ProbeRecord = {
        at,
        result: failure.result,
        notReadyReason: null,
        implementation: null,
        model: null,
        capabilities: null,
      };
      deps.cache.set(entry.id, record);
      log(entry, record);
      return { record, error: failure.error };
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    probe,
    offlineSince(serviceId) {
      const record = deps.cache.get(serviceId);
      return record?.result === 'offline' ? record.at : null;
    },
  };
}
