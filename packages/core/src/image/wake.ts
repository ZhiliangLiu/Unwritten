import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ErrorCode, LauncherFailureReason } from '@unwritten/contracts';
import { IMAGE_IDLE_MINUTES } from '@unwritten/contracts';
import type { EventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { resolveApiKey } from '../providers/keys.ts';
import type { ProvidersStore } from '../providers/file.ts';
import type { ImageServiceEntry } from '../providers/schema.ts';
import { UNKNOWN_WAKE_VIEW, type ImageWakeView } from './config.ts';
import { ImageError } from './errors.ts';
import { createLauncherClient, type LauncherClient } from './launcher-client.ts';
import type { ProbeOutcome } from './probe.ts';

export const IMAGE_WAKE_POLL_MS = 5_000;
export const IMAGE_WAKE_TIMEOUT_MS = 1_800_000;

const MAX_WAKE_RESTARTS = 3;
const STOP_TIMEOUT_MS = 5_000;

export type WakeTrigger = 'prewarm' | 'demand';

export interface Waker {
  ensureAwake(serviceId: string, trigger: WakeTrigger): Promise<void>;
  isWaking(serviceId: string): boolean;
  continueWake(serviceId: string, requestId: string): Promise<void>;
  markReady(serviceId: string): void;
  stateOf(serviceId: string): ImageWakeView;
  whenIdle(): Promise<void>;
}

export interface WakerDeps {
  store: ProvidersStore;
  logger: Logger;
  bus: EventBus;
  shutdown: AbortSignal;
  env: NodeJS.ProcessEnv;
  probe(entry: ImageServiceEntry, signal?: AbortSignal): Promise<ProbeOutcome | null>;
  fetch?: typeof fetch;
  pollMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function createWaker(deps: WakerDeps): Waker {
  const now = deps.now ?? Date.now;
  const pollMs = deps.pollMs ?? IMAGE_WAKE_POLL_MS;
  const timeoutMs = deps.timeoutMs ?? IMAGE_WAKE_TIMEOUT_MS;
  const sleep = deps.sleep ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
  const states = new Map<string, ImageWakeView>();
  const inFlight = new Map<string, Promise<void>>();

  const entryOf = (serviceId: string): ImageServiceEntry | null => {
    const state = deps.store.load();
    if (state.status !== 'ok') return null;
    return state.file.imageServices.find((entry) => entry.id === serviceId) ?? null;
  };

  const launcherFor = (entry: ImageServiceEntry): LauncherClient | null => {
    if (entry.launcher === undefined) return null;
    return createLauncherClient({
      baseUrl: entry.launcher.baseUrl,
      token: resolveApiKey(entry.launcher.apiKey, deps.env),
      fetch: deps.fetch,
    });
  };

  const setState = (serviceId: string, next: ImageWakeView): void => {
    const previous = states.get(serviceId) ?? UNKNOWN_WAKE_VIEW;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    states.set(serviceId, next);
    deps.bus.publish({ type: 'image.service_state', serviceId });
  };

  const stopLauncher = async (client: LauncherClient): Promise<void> => {
    try {
      await client.stop(
        { idempotencyKey: randomUUID() },
        AbortSignal.any([deps.shutdown, AbortSignal.timeout(STOP_TIMEOUT_MS)]),
      );
    } catch {
      return;
    }
  };

  const runWake = async (serviceId: string, trigger: WakeTrigger): Promise<void> => {
    const startedAt = now();
    let userAction = false;
    let reason: LauncherFailureReason | null = null;
    let outcome: 'ok' | 'error' | 'interrupted' = 'error';

    deps.logger.record({
      level: 'info',
      module: 'image',
      event: 'image.wake.started',
      data: { serviceId, trigger },
    });

    try {
      const entry = entryOf(serviceId);
      if (entry === null) throw new ImageError('image_not_configured', 'final');
      const client = launcherFor(entry);
      if (client === null) throw new ImageError('image_wake_failed', 'final');

      const idleMinutes = entry.idleMinutes ?? IMAGE_IDLE_MINUTES;
      const deadline = startedAt + timeoutMs;
      let restarts = 0;
      let snapshot = await client.start({ idempotencyKey: randomUUID(), idleMinutes }, deps.shutdown);

      for (;;) {
        switch (snapshot.state) {
          case 'needs_action': {
            userAction = true;
            setState(serviceId, { state: 'needs_action', action: snapshot.action, wakeFailure: null });
            break;
          }
          case 'starting': {
            setState(serviceId, { state: 'waking', action: null, wakeFailure: null });
            break;
          }
          case 'running': {
            const probe = await deps.probe(entry, deps.shutdown);
            if (probe !== null && probe.record.result === 'ready') {
              setState(serviceId, { state: 'ready', action: null, wakeFailure: null });
              outcome = 'ok';
              return;
            }
            if (probe !== null && probe.record.result === 'not_ready' && probe.record.notReadyReason === 'starting') {
              setState(serviceId, { state: 'waking', action: null, wakeFailure: null });
              break;
            }
            if (probe !== null && probe.record.result === 'offline') {
              setState(serviceId, { state: 'waking', action: null, wakeFailure: null });
              break;
            }
            throw probe?.error ?? new ImageError('image_wake_failed', 'final');
          }
          case 'failed': {
            reason = snapshot.reason;
            throw new ImageError('image_wake_failed', 'final');
          }
          case 'stopped':
          case 'stopping': {
            restarts += 1;
            if (restarts > MAX_WAKE_RESTARTS) throw new ImageError('image_wake_failed', 'final');
            snapshot = await client.start({ idempotencyKey: randomUUID(), idleMinutes }, deps.shutdown);
            break;
          }
        }

        if (now() >= deadline) {
          await stopLauncher(client);
          throw new ImageError('image_wake_timeout', 'final');
        }
        await sleep(pollMs, deps.shutdown);
        snapshot = await client.state(deps.shutdown);
      }
    } catch (error) {
      if (deps.shutdown.aborted || isAbortError(error)) {
        outcome = 'interrupted';
        throw error;
      }
      const code: ErrorCode = error instanceof ImageError ? error.code : 'image_wake_failed';
      setState(serviceId, { state: 'wake_failed', action: null, wakeFailure: { code, reason } });
      deps.logger.record({
        level: 'warn',
        module: 'image',
        event: 'image.wake.failed',
        data: { serviceId, trigger, code, ...(reason === null ? {} : { reason }) },
      });
      throw error instanceof ImageError ? error : new ImageError('image_wake_failed', 'final', { cause: error });
    } finally {
      if (outcome === 'ok') {
        deps.logger.record({
          level: 'info',
          module: 'image',
          event: 'image.wake.done',
          data: { serviceId, trigger, userAction, durationMs: now() - startedAt },
        });
      }
      deps.logger.sample({
        metric: 'image.wake',
        durationMs: now() - startedAt,
        outcome,
        data: { trigger, userAction },
      });
    }
  };

  const ensureAwake = (serviceId: string, trigger: WakeTrigger): Promise<void> => {
    const existing = inFlight.get(serviceId);
    if (existing !== undefined) return existing;
    let promise: Promise<void>;
    promise = runWake(serviceId, trigger).finally(() => {
      if (inFlight.get(serviceId) === promise) inFlight.delete(serviceId);
    });
    inFlight.set(serviceId, promise);
    return promise;
  };

  return {
    ensureAwake,
    isWaking(serviceId) {
      return inFlight.has(serviceId);
    },
    async continueWake(serviceId, requestId) {
      const entry = entryOf(serviceId);
      const client = entry === null ? null : launcherFor(entry);
      if (client === null) throw new ImageError('image_wake_failed', 'final');
      await client.continue({ idempotencyKey: requestId }, deps.shutdown);
    },
    markReady(serviceId) {
      if (entryOf(serviceId)?.launcher === undefined) return;
      setState(serviceId, { state: 'ready', action: null, wakeFailure: null });
    },
    stateOf(serviceId) {
      return states.get(serviceId) ?? UNKNOWN_WAKE_VIEW;
    },
    async whenIdle() {
      while (inFlight.size > 0) {
        await Promise.allSettled(inFlight.values());
      }
    },
  };
}
