import {
  CoreToDesktopSchema,
  type DesktopToCore,
  type ReadyMessage,
  type StartFailureReason,
  type StartMessage,
} from '@unwritten/contracts/desktop';
import type { DesktopDiagnostics } from './diagnostics.ts';

export const CORE_READY_TIMEOUT_MS = 30_000;
export const CORE_STOP_TIMEOUT_MS = 5_000;
export type DesktopStartFailure = StartFailureReason | 'timeout' | 'exited';

export type Appearance = ReadyMessage['appearance'];

export interface CoreChild {
  postMessage(message: DesktopToCore): void;
  onMessage(listener: (data: unknown) => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

export interface CoreProcessDeps {
  fork(entry: string, env: NodeJS.ProcessEnv): CoreChild;
  setTimer(callback: () => void, ms: number): () => void;
  now(): number;
  createToken(): string;
  diagnostics: DesktopDiagnostics;
}

export interface CoreLaunch {
  entry: string;
  env: NodeJS.ProcessEnv;
  start: Omit<StartMessage, 'type' | 'token'>;
}

export type CoreStartResult =
  | { ok: true; port: number; token: string; appearance: Appearance }
  | { ok: false; reason: DesktopStartFailure; diagnosticId: string | null };

export interface CoreProcess {
  start(launch: CoreLaunch): Promise<CoreStartResult>;
  stop(): Promise<void>;
  onAppearanceChanged(listener: (appearance: Appearance) => void): void;
  onUnexpectedExit(listener: (code: number | null) => void): void;
}

export function createCoreProcess(deps: CoreProcessDeps): CoreProcess {
  let state: 'idle' | 'starting' | 'running' | 'stopping' = 'idle';
  let attempt = 0;
  let child: CoreChild | null = null;
  let cancelReadyTimer: (() => void) | null = null;
  let cancelStopTimer: (() => void) | null = null;
  let finishStop: (() => void) | null = null;
  const appearanceListeners: Array<(appearance: Appearance) => void> = [];
  const unexpectedExitListeners: Array<(code: number | null) => void> = [];

  const clearReadyTimeout = (): void => {
    if (cancelReadyTimer) {
      cancelReadyTimer();
      cancelReadyTimer = null;
    }
  };

  function start(launch: CoreLaunch): Promise<CoreStartResult> {
    attempt += 1;
    const currentAttempt = attempt;
    const token = deps.createToken();
    const startedAt = deps.now();
    const current = deps.fork(launch.entry, launch.env);
    child = current;
    state = 'starting';

    let settled = false;
    let resolveStart: (result: CoreStartResult) => void = () => {};
    const result = new Promise<CoreStartResult>((resolve) => {
      resolveStart = resolve;
    });

    const settle = (value: CoreStartResult): void => {
      if (settled) return;
      settled = true;
      resolveStart(value);
    };

    const sample = (outcome: 'ok' | 'error'): void => {
      deps.diagnostics.sample({
        metric: 'desktop.core_ready',
        durationMs: deps.now() - startedAt,
        outcome,
        attempt: currentAttempt,
      });
    };

    current.onMessage((data) => {
      if (child !== current) return;
      const parsed = CoreToDesktopSchema.safeParse(data);
      if (!parsed.success) return;
      const message = parsed.data;

      if (state === 'starting') {
        if (message.type === 'ready') {
          clearReadyTimeout();
          state = 'running';
          deps.diagnostics.attach((entry) => current.postMessage({ type: 'log', entry }));
          sample('ok');
          settle({ ok: true, port: message.port, token, appearance: message.appearance });
        } else if (message.type === 'start-failed') {
          clearReadyTimeout();
          current.kill();
          sample('error');
          settle({ ok: false, reason: message.reason, diagnosticId: message.diagnosticId });
          state = 'idle';
        }
        return;
      }

      if (state === 'running' && message.type === 'appearance-changed') {
        for (const listener of appearanceListeners) listener(message.appearance);
      }
    });

    current.onExit((code) => {
      if (child !== current) return;

      if (state === 'starting') {
        clearReadyTimeout();
        deps.diagnostics.record({
          event: 'desktop.core_exited',
          level: 'warn',
          data: { code, phase: 'starting' },
        });
        sample('error');
        settle({ ok: false, reason: 'exited', diagnosticId: null });
        state = 'idle';
        child = null;
        return;
      }

      if (state === 'running') {
        deps.diagnostics.detach();
        deps.diagnostics.record({
          event: 'desktop.core_exited',
          level: 'warn',
          data: { code, phase: 'running' },
        });
        state = 'idle';
        child = null;
        for (const listener of unexpectedExitListeners) listener(code);
        return;
      }

      if (state === 'stopping') {
        if (cancelStopTimer) {
          cancelStopTimer();
          cancelStopTimer = null;
        }
        state = 'idle';
        child = null;
        if (finishStop) {
          const finish = finishStop;
          finishStop = null;
          finish();
        }
      }
    });

    cancelReadyTimer = deps.setTimer(() => {
      cancelReadyTimer = null;
      deps.diagnostics.record({ event: 'desktop.core_ready_timeout', level: 'error', data: {} });
      current.kill();
      sample('error');
      settle({ ok: false, reason: 'timeout', diagnosticId: null });
      state = 'idle';
    }, CORE_READY_TIMEOUT_MS);

    current.postMessage({ type: 'start', token, ...launch.start });

    return result;
  }

  function stop(): Promise<void> {
    if (state === 'idle') return Promise.resolve();

    const current = child;
    if (!current) return Promise.resolve();

    state = 'stopping';
    clearReadyTimeout();
    deps.diagnostics.detach();

    return new Promise<void>((resolve) => {
      finishStop = resolve;
      current.postMessage({ type: 'stop' });
      cancelStopTimer = deps.setTimer(() => {
        cancelStopTimer = null;
        current.kill();
      }, CORE_STOP_TIMEOUT_MS);
    });
  }

  return {
    start,
    stop,
    onAppearanceChanged(listener) {
      appearanceListeners.push(listener);
    },
    onUnexpectedExit(listener) {
      unexpectedExitListeners.push(listener);
    },
  };
}
