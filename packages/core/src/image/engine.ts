import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ErrorCode, ImageCapabilities } from '@unwritten/contracts';
import type { Logger } from '../log/logger.ts';
import { resolveApiKey } from '../providers/keys.ts';
import type { ProvidersStore } from '../providers/file.ts';
import type { ImageServiceEntry } from '../providers/schema.ts';
import type { Database } from '../store/db.ts';
import { recordCall } from './calls.ts';
import type { ImageDispatchGuard, ImageGenerateInput, ImageGenerateResult } from './engine-types.ts';
import { ImageError } from './errors.ts';
import { openAiCapabilities, openAiSizeFor, prefillOpenAiOptions } from './openai-capabilities.ts';
import { createOpenAiImageClient } from './openai-client.ts';
import type { ProbeCache, Prober } from './probe.ts';
import { FAST_IMAGE_PRIORITY, NORMAL_IMAGE_PRIORITY, type ImageQueue } from './queue.ts';
import { createUnwrittenImageClient } from './unwritten-client.ts';
import { aspectMatches, validateImageBytes } from './validate.ts';
import type { WakeTrigger, Waker } from './wake.ts';

export const IMAGE_POLL_INTERVAL_MS = 2_000;
export const IMAGE_JOB_TIMEOUT_MS = 600_000;
export const IMAGE_OFFLINE_TTL_MS = 60_000;

export { IMAGE_CALL_RETENTION_DAYS } from './calls.ts';
export { IMAGE_WAKE_POLL_MS, IMAGE_WAKE_TIMEOUT_MS } from './wake.ts';

export const PAID_TEST_PROMPT =
  'A single white ceramic cup on a blue tabletop, soft daylight, centered still life, no text or logos.';

export interface PrepareGenerationOptions {
  manual: boolean;
  signal: AbortSignal;
  onWaiting?: () => void;
  guard?: ImageDispatchGuard;
}

export interface ImageEngine {
  prepareGeneration(serviceId: string, options: PrepareGenerationOptions): Promise<ImageCapabilities>;
  assertGenerationFormat(
    capabilities: ImageCapabilities,
    format: Pick<ImageGenerateInput, 'aspect' | 'size' | 'quality'>,
  ): void;
  generate(input: ImageGenerateInput): Promise<ImageGenerateResult>;
  wake(serviceId: string, trigger: WakeTrigger): void;
  whenIdle(): Promise<void>;
}

export interface ImageEngineDeps {
  store: ProvidersStore;
  cache: ProbeCache;
  queue: ImageQueue;
  prober: Prober;
  waker: Waker;
  db: Database;
  logger: Logger;
  shutdown: AbortSignal;
  env: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollIntervalMs?: number;
  jobTimeoutMs?: number;
  offlineTtlMs?: number;
}

interface Attempt {
  aspect: string;
  size: { width: number; height: number } | null;
  quality: 'fast' | 'best';
  seed: number | null;
  negativePrompt: string | null;
}

function abortError(): DOMException {
  return new DOMException('image dispatch is no longer current', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function configuredCapabilities(entry: ImageServiceEntry): ImageCapabilities {
  return openAiCapabilities(entry.capabilities ?? prefillOpenAiOptions(entry.model ?? ''));
}

export function createImageEngine(deps: ImageEngineDeps): ImageEngine {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
  const pollIntervalMs = deps.pollIntervalMs ?? IMAGE_POLL_INTERVAL_MS;
  const jobTimeoutMs = deps.jobTimeoutMs ?? IMAGE_JOB_TIMEOUT_MS;
  const offlineTtlMs = deps.offlineTtlMs ?? IMAGE_OFFLINE_TTL_MS;
  const background = new Set<Promise<void>>();

  const findEntry = (serviceId: string): ImageServiceEntry | null => {
    const state = deps.store.load();
    if (state.status !== 'ok') return null;
    return state.file.imageServices.find((entry) => entry.id === serviceId) ?? null;
  };

  const currentEntry = (serviceId: string): ImageServiceEntry => {
    const entry = findEntry(serviceId);
    if (entry === null) throw new ImageError('image_not_configured', 'final');
    return entry;
  };

  const checkGuard = (entry: ImageServiceEntry, guard: ImageDispatchGuard | undefined): void => {
    if (guard === undefined) return;
    guard.assertCurrent();
    const model = entry.protocol === 'openai-images' ? (entry.model ?? null) : null;
    if (model !== guard.model) throw abortError();
  };

  const checkedEntry = (serviceId: string, guard: ImageDispatchGuard | undefined): ImageServiceEntry => {
    const entry = currentEntry(serviceId);
    checkGuard(entry, guard);
    return entry;
  };

  const effectiveQuality = (capabilities: ImageCapabilities, requested: 'fast' | 'best'): 'fast' | 'best' => {
    if (capabilities.qualities.includes(requested)) return requested;
    if (capabilities.qualities.includes('best')) return 'best';
    throw new ImageError('image_output_format_unavailable', 'format');
  };

  const assertGenerationFormat = (
    capabilities: ImageCapabilities,
    format: Pick<ImageGenerateInput, 'aspect' | 'size' | 'quality'>,
  ): void => {
    if (!capabilities.aspects.includes(format.aspect)) {
      throw new ImageError('image_output_format_unavailable', 'format');
    }
    effectiveQuality(capabilities, format.quality);
    const size = format.size;
    if (size !== null) {
      const tiers = capabilities.resolutions[format.aspect] ?? {};
      const supported = Object.values(tiers).some(
        (candidate) => candidate.width === size.width && candidate.height === size.height,
      );
      if (!supported) throw new ImageError('image_output_format_unavailable', 'format');
    }
  };

  const buildAttempt = (capabilities: ImageCapabilities, input: ImageGenerateInput): Attempt => {
    const quality = effectiveQuality(capabilities, input.quality);
    assertGenerationFormat(capabilities, { aspect: input.aspect, size: input.size, quality });
    if (input.references.length > capabilities.maxReferences) {
      throw new ImageError('image_invalid_request', 'final');
    }
    return {
      aspect: input.aspect,
      size: input.size,
      quality,
      seed: capabilities.seed ? input.seed : null,
      negativePrompt: capabilities.negativePrompt ? input.negativePrompt : null,
    };
  };

  const waitForWake = (serviceId: string, signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.reject(abortError());
    const wake = deps.waker.ensureAwake(serviceId, 'demand');
    return new Promise((resolve, reject) => {
      const cleanup = (): void => signal.removeEventListener('abort', onAbort);
      const onAbort = (): void => {
        cleanup();
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      wake.then(
        () => {
          cleanup();
          resolve();
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
    });
  };

  const prepareGeneration = async (
    serviceId: string,
    options: PrepareGenerationOptions,
  ): Promise<ImageCapabilities> => {
    let entry = checkedEntry(serviceId, options.guard);
    if (entry.protocol === 'openai-images') return configuredCapabilities(entry);

    if (deps.waker.isWaking(serviceId)) {
      options.onWaiting?.();
      await waitForWake(serviceId, options.signal);
      entry = checkedEntry(serviceId, options.guard);
      if (entry.protocol === 'openai-images') return configuredCapabilities(entry);
    }

    if (!options.manual && entry.launcher === undefined) {
      const offlineSince = deps.prober.offlineSince(serviceId);
      if (offlineSince !== null && now() - offlineSince <= offlineTtlMs) {
        throw new ImageError('image_offline', 'transport');
      }
    }

    const outcome = await deps.prober.probe(entry, options.signal);
    entry = checkedEntry(serviceId, options.guard);
    if (entry.protocol === 'openai-images') return configuredCapabilities(entry);
    if (outcome === null) throw new ImageError('image_not_ready', 'final');
    if (outcome.record.result === 'ready' && outcome.record.capabilities !== null) {
      return outcome.record.capabilities;
    }

    if (outcome.record.result === 'offline' && entry.launcher !== undefined) {
      options.onWaiting?.();
      await waitForWake(serviceId, options.signal);
      entry = checkedEntry(serviceId, options.guard);
      if (entry.protocol === 'openai-images') return configuredCapabilities(entry);
      const record = deps.cache.get(serviceId);
      if (record?.result === 'ready' && record.capabilities !== null) return record.capabilities;
      throw new ImageError('image_offline', 'transport');
    }

    throw outcome.error ?? new ImageError('image_not_ready', 'final');
  };

  const validateResult = (
    bytes: Uint8Array,
    input: ImageGenerateInput,
  ): { mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number } => {
    const validation = validateImageBytes(bytes, { rejectMetadata: input.ref.kind === 'portrait' });
    if (!validation.ok) throw new ImageError('image_invalid_response', 'final');
    const { mime, width, height } = validation.image;
    if (input.size !== null) {
      if (width !== input.size.width || height !== input.size.height) {
        throw new ImageError('image_invalid_response', 'final');
      }
    } else if (!aspectMatches(width, height, input.aspect)) {
      throw new ImageError('image_invalid_response', 'final');
    }
    return { mime, width, height };
  };

  const runUnwritten = async (
    entry: ImageServiceEntry,
    input: ImageGenerateInput,
    attempt: Attempt,
  ): Promise<{ bytes: Uint8Array; seed: number | null }> => {
    checkGuard(entry, input.guard);
    const client = createUnwrittenImageClient({
      baseUrl: entry.baseUrl,
      token: resolveApiKey(entry.apiKey, deps.env),
      fetch: deps.fetch,
    });
    const result = await client.run(
      {
        idempotencyKey: randomUUID(),
        prompt: input.prompt,
        negativePrompt: attempt.negativePrompt,
        references: input.references,
        aspect: attempt.aspect,
        size: attempt.size,
        quality: attempt.quality,
        seed: attempt.seed,
      },
      {
        signal: input.signal,
        pollIntervalMs,
        jobTimeoutMs,
        beforeSubmit: () => checkGuard(entry, input.guard),
      },
    );
    return { bytes: result.bytes, seed: result.seed };
  };

  const runOpenAi = async (
    entry: ImageServiceEntry,
    input: ImageGenerateInput,
    attempt: Attempt,
  ): Promise<{ bytes: Uint8Array; inputTokens: number | null; outputTokens: number | null }> => {
    const options = entry.capabilities ?? prefillOpenAiOptions(entry.model ?? '');
    const size = attempt.size ?? openAiSizeFor(options.sizes, attempt.aspect, 'default');
    if (size === null) throw new ImageError('image_output_format_unavailable', 'format');
    checkGuard(entry, input.guard);
    const client = createOpenAiImageClient({
      baseUrl: entry.baseUrl,
      apiKey: resolveApiKey(entry.apiKey, deps.env),
      model: entry.model ?? '',
      fetch: deps.fetch,
    });
    const result = await client.generate(
      { prompt: input.prompt, references: input.references, size, quality: attempt.quality },
      input.signal,
    );
    return { bytes: result.bytes, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  };

  const runGenerate = async (
    input: ImageGenerateInput,
    fallbackEntry: ImageServiceEntry | null,
  ): Promise<ImageGenerateResult> => {
    const startedAt = performance.now();
    let entry = fallbackEntry;
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let usedQuality: 'fast' | 'best' = input.quality;

    const finish = (target: ImageServiceEntry, status: 'ok' | 'error' | 'aborted', error: ErrorCode | null): string => {
      const callId = recordCall(deps.db, {
        serviceId: target.id,
        protocol: target.protocol,
        model: target.protocol === 'openai-images' ? (target.model ?? null) : null,
        workId: input.ref.workId,
        refKind: input.ref.kind,
        refId: input.ref.id,
        quality: usedQuality,
        referenceCount: input.references.length,
        inputTokens,
        outputTokens,
        durationMs: Math.round(performance.now() - startedAt),
        status,
        error,
        createdAt: now(),
      });
      deps.logger.sample({
        metric: 'image.generate',
        durationMs: Math.round(performance.now() - startedAt),
        outcome: status === 'aborted' ? 'interrupted' : status,
        callId,
        data: {
          protocol: target.protocol,
          quality: usedQuality,
          references: input.references.length,
          ...(error === null ? {} : { code: error }),
        },
      });
      return callId;
    };

    try {
      entry = checkedEntry(input.serviceId, input.guard);
      let capabilities = await prepareGeneration(input.serviceId, {
        manual: input.manual,
        signal: input.signal,
        guard: input.guard,
      });
      entry = checkedEntry(input.serviceId, input.guard);
      let attempt = buildAttempt(capabilities, input);
      usedQuality = attempt.quality;
      let retried = false;

      for (;;) {
        try {
          let bytes: Uint8Array;
          let seed: number | null = null;
          if (entry.protocol === 'unwritten-image') {
            const outcome = await runUnwritten(entry, input, attempt);
            bytes = outcome.bytes;
            seed = outcome.seed;
          } else {
            const outcome = await runOpenAi(entry, input, attempt);
            bytes = outcome.bytes;
            inputTokens = outcome.inputTokens;
            outputTokens = outcome.outputTokens;
          }
          const validated = validateResult(bytes, input);
          const model = entry.protocol === 'openai-images' ? (entry.model ?? null) : null;
          const callId = finish(entry, 'ok', null);
          return {
            bytes,
            mime: validated.mime,
            width: validated.width,
            height: validated.height,
            seed,
            serviceId: entry.id,
            model,
            callId,
          };
        } catch (error) {
          if (input.signal.aborted || isAbortError(error)) throw error;
          if (!(error instanceof ImageError) || error.submitted || retried) throw error;

          if (error.kind === 'transport' || error.kind === 'busy') {
            if (entry.protocol !== 'openai-images') throw error;
            retried = true;
            await sleep(error.retryAfterMs ?? 0, input.signal);
            entry = checkedEntry(input.serviceId, input.guard);
            attempt = buildAttempt(configuredCapabilities(entry), input);
            usedQuality = attempt.quality;
            continue;
          }

          if (error.kind === 'capability' || error.kind === 'format') {
            retried = true;
            const outcome = await deps.prober.probe(entry, input.signal);
            entry = checkedEntry(input.serviceId, input.guard);
            let capabilities: ImageCapabilities;
            if (entry.protocol === 'openai-images') {
              capabilities = configuredCapabilities(entry);
            } else if (outcome !== null && outcome.record.result === 'ready' && outcome.record.capabilities !== null) {
              capabilities = outcome.record.capabilities;
            } else {
              throw outcome?.error ?? error;
            }
            attempt = buildAttempt(capabilities, input);
            usedQuality = attempt.quality;
            continue;
          }

          throw error;
        }
      }
    } catch (error) {
      if (entry !== null) {
        const aborted = input.signal.aborted || isAbortError(error);
        finish(
          entry,
          aborted ? 'aborted' : 'error',
          aborted ? null : error instanceof ImageError ? error.code : 'internal',
        );
      }
      throw error;
    }
  };

  const wake = (serviceId: string, trigger: WakeTrigger): void => {
    if (deps.shutdown.aborted) return;
    const task = (async () => {
      try {
        const entry = findEntry(serviceId);
        if (entry === null || entry.launcher === undefined) return;
        if (deps.waker.isWaking(serviceId)) {
          await deps.waker.ensureAwake(serviceId, trigger);
          return;
        }
        const outcome = await deps.prober.probe(entry, deps.shutdown);
        if (outcome === null || outcome.record.result === 'ready') return;
        if (outcome.error?.code !== 'image_offline') return;
        await deps.waker.ensureAwake(serviceId, trigger);
      } catch {
        return;
      }
    })();
    background.add(task);
    void task.finally(() => background.delete(task));
  };

  return {
    prepareGeneration,
    assertGenerationFormat,
    generate(input) {
      const initial = findEntry(input.serviceId);
      const priority = input.quality === 'fast' ? FAST_IMAGE_PRIORITY : NORMAL_IMAGE_PRIORITY;
      return deps.queue.run(input.serviceId, priority, () => runGenerate(input, initial));
    },
    wake,
    async whenIdle() {
      for (;;) {
        await Promise.all([deps.queue.whenIdle(), deps.waker.whenIdle(), ...background]);
        if (background.size === 0) return;
      }
    },
  };
}
