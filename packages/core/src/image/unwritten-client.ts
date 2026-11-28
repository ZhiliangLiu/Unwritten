import { setTimeout as delay } from 'node:timers/promises';
import { ImageError } from './errors.ts';
import { IMAGE_MAX_BYTES } from './limits.ts';
import { parseServiceInfo, type ServiceInfo } from './info.ts';
import { createNetFetch, RedirectBlockedError } from '../net/fetch.ts';

export interface UnwrittenJobRequest {
  idempotencyKey: string;
  prompt: string;
  negativePrompt: string | null;
  references: Array<{ mime: string; bytes: Uint8Array }>;
  aspect: string;
  size: { width: number; height: number } | null;
  quality: 'fast' | 'best';
  seed: number | null;
}

export interface UnwrittenJobResult {
  bytes: Uint8Array;
  seed: number | null;
  width: number | null;
  height: number | null;
}

export interface UnwrittenImageClient {
  info(signal: AbortSignal): Promise<ServiceInfo>;
  run(
    request: UnwrittenJobRequest,
    options: { signal: AbortSignal; pollIntervalMs: number; jobTimeoutMs: number; beforeSubmit?: () => void },
  ): Promise<UnwrittenJobResult>;
}

const RELEASE_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const MAX_RETRY_AFTER_MS = 60_000;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  if (header === null) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

function errorCodeOf(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  return typeof payload.error.code === 'string' ? payload.error.code : null;
}

async function toImageError(response: Response): Promise<ImageError> {
  const code = errorCodeOf(await readJson(response));
  const status = response.status;

  if (code === 'unauthorized' || status === 401) return new ImageError('image_unauthorized', 'final');
  if (code === 'too_many_references' || code === 'reference_too_large') {
    return new ImageError('image_invalid_request', 'capability');
  }
  if (code === 'unsupported_aspect' || code === 'unsupported_size' || code === 'unsupported_quality') {
    return new ImageError('image_output_format_unavailable', 'format');
  }
  if (code === 'invalid_request' || code === 'idempotency_conflict' || status === 400) {
    return new ImageError('image_invalid_request', 'final');
  }
  if (code === 'not_ready' || status === 503) return new ImageError('image_not_ready', 'final');
  if (code === 'not_found' || status === 404) return new ImageError('image_interrupted', 'final');
  if (status === 429) return new ImageError('image_busy', 'busy');
  return new ImageError('image_server', 'final');
}

const TASK_ERROR_CODES: Record<
  string,
  'image_out_of_memory' | 'image_workflow_error' | 'image_refused' | 'image_interrupted'
> = {
  out_of_memory: 'image_out_of_memory',
  workflow_error: 'image_workflow_error',
  refused: 'image_refused',
  interrupted: 'image_interrupted',
};

function taskError(payload: Record<string, unknown>): ImageError {
  const error = isRecord(payload.error) ? payload.error : {};
  const code = typeof error.code === 'string' ? error.code : null;
  const mapped = code === null ? undefined : TASK_ERROR_CODES[code];
  return new ImageError(mapped ?? 'image_server', 'final');
}

async function readCappedBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.length;
      if (total > IMAGE_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new ImageError('image_invalid_response', 'final');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ImageError || isAbortError(error)) throw error;
    throw new ImageError('image_invalid_response', 'final', { cause: error });
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function createUnwrittenImageClient(options: {
  baseUrl: string;
  token: string | undefined;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): UnwrittenImageClient {
  const baseUrl = options.baseUrl.replace(/\/+$/u, '');
  const fetchFn = options.fetch ?? createNetFetch();
  const sleep = options.sleep ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
  const authHeaders: Record<string, string> = options.token ? { authorization: `Bearer ${options.token}` } : {};
  const jobsUrl = `${baseUrl}/v1/jobs`;

  const request = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetchFn(url, init);
    } catch (error) {
      if (error instanceof RedirectBlockedError) {
        throw new ImageError('image_redirected', 'final', { cause: error });
      }
      throw error;
    }
  };

  const release = async (id: string): Promise<void> => {
    try {
      await request(`${jobsUrl}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders,
        signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
      });
    } catch {
      return;
    }
  };

  return {
    async info(signal) {
      let response: Response;
      try {
        response = await request(`${baseUrl}/v1/info`, { headers: authHeaders, signal });
      } catch (error) {
        if (error instanceof ImageError || isAbortError(error) || signal.aborted) throw error;
        throw new ImageError('image_offline', 'transport', { cause: error });
      }
      if (!response.ok) throw await toImageError(response);
      const parsed = parseServiceInfo(await readJson(response));
      if (!parsed.ok) throw new ImageError('image_invalid_response', 'final');
      return parsed.info;
    },

    async run(job, jobOptions) {
      const body = JSON.stringify({
        idempotencyKey: job.idempotencyKey,
        prompt: job.prompt,
        references: job.references.map((reference) => ({
          mime: reference.mime,
          data: Buffer.from(reference.bytes).toString('base64'),
        })),
        aspect: job.aspect,
        quality: job.quality,
        ...(job.size === null ? {} : { size: job.size }),
        ...(job.seed === null ? {} : { seed: job.seed }),
        ...(job.negativePrompt === null ? {} : { negativePrompt: job.negativePrompt }),
      });

      const submitAttempt = (signal: AbortSignal): Promise<Response> => {
        jobOptions.beforeSubmit?.();
        return request(jobsUrl, {
          method: 'POST',
          headers: { ...authHeaders, 'content-type': 'application/json' },
          body,
          signal,
        });
      };

      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), jobOptions.jobTimeoutMs);
      const signal = AbortSignal.any([jobOptions.signal, timeout.signal]);
      let jobId: string | null = null;

      try {
        let response: Response;
        try {
          response = await submitAttempt(signal);
        } catch (error) {
          if (error instanceof ImageError || isAbortError(error)) throw error;
          try {
            response = await submitAttempt(signal);
          } catch (second) {
            if (second instanceof ImageError || isAbortError(second)) throw second;
            throw new ImageError('image_offline', 'transport', { cause: second });
          }
        }

        if (response.status === 429) {
          const waitMs = retryAfterMs(response);
          await response.body?.cancel().catch(() => {});
          await sleep(waitMs, signal);
          response = await submitAttempt(signal);
          if (response.status === 429) throw new ImageError('image_busy', 'busy', { retryAfterMs: waitMs });
        }

        if (!response.ok) throw await toImageError(response);
        const submitted = await readJson(response);
        const id = isRecord(submitted) && typeof submitted.id === 'string' ? submitted.id : null;
        if (id === null || id.length === 0) throw new ImageError('image_invalid_response', 'final');
        jobId = id;

        let seed: number | null = null;
        let width: number | null = null;
        let height: number | null = null;
        for (;;) {
          await sleep(jobOptions.pollIntervalMs, signal);
          const statusResponse = await request(`${jobsUrl}/${encodeURIComponent(jobId)}`, {
            headers: authHeaders,
            signal,
          });
          if (!statusResponse.ok) throw await toImageError(statusResponse);
          const statusPayload = await readJson(statusResponse);
          if (!isRecord(statusPayload)) throw new ImageError('image_invalid_response', 'final');
          const status = statusPayload.status;
          if (status === 'done') {
            seed = integerOrNull(statusPayload.seed);
            width = integerOrNull(statusPayload.width);
            height = integerOrNull(statusPayload.height);
            break;
          }
          if (status === 'failed') throw taskError(statusPayload);
          if (status === 'cancelled') throw new ImageError('image_interrupted', 'final');
          if (status !== 'queued' && status !== 'running') {
            throw new ImageError('image_invalid_response', 'final');
          }
        }

        const imageResponse = await request(`${jobsUrl}/${encodeURIComponent(jobId)}/image`, {
          headers: authHeaders,
          signal,
        });
        if (!imageResponse.ok) throw await toImageError(imageResponse);
        const bytes = await readCappedBytes(imageResponse);
        await release(jobId);
        return { bytes, seed, width, height };
      } catch (error) {
        if (jobOptions.signal.aborted) {
          if (jobId !== null) await release(jobId);
          if (isAbortError(error)) throw error;
          throw new DOMException('aborted', 'AbortError');
        }
        if (timeout.signal.aborted) {
          if (jobId !== null) await release(jobId);
          throw new ImageError('image_timeout', 'final', { cause: error });
        }
        if (error instanceof ImageError || isAbortError(error)) throw error;
        throw new ImageError('image_offline', 'transport', { cause: error });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
