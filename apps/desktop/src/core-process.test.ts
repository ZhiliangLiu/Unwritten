import type { DesktopToCore } from '@unwritten/contracts/desktop';
import { describe, expect, it } from 'vitest';
import {
  CORE_READY_TIMEOUT_MS,
  CORE_STOP_TIMEOUT_MS,
  createCoreProcess,
  type Appearance,
  type CoreChild,
  type CoreLaunch,
  type CoreProcessDeps,
} from './core-process.ts';
import { createDesktopDiagnostics } from './diagnostics.ts';

const appearance: Appearance = {
  appearance: 'dark',
  proseSize: '3',
  proseFont: 'serif',
  proseLeading: 'comfortable',
  proseLayout: 'book',
  proseIndent: '2',
};

const diagnosticId = '00000000-0000-4000-8000-000000000000';

class FakeChild implements CoreChild {
  messages: DesktopToCore[] = [];
  killCount = 0;
  private messageListeners: Array<(data: unknown) => void> = [];
  private exitListeners: Array<(code: number | null) => void> = [];

  postMessage(message: DesktopToCore): void {
    this.messages.push(message);
  }

  onMessage(listener: (data: unknown) => void): void {
    this.messageListeners.push(listener);
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener);
  }

  kill(): void {
    this.killCount += 1;
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) listener(data);
  }

  emitExit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code);
  }
}

interface FakeTimer {
  callback: () => void;
  ms: number;
  cancelled: boolean;
  fired: boolean;
}

function createHarness() {
  const calls: unknown[][] = [];
  const children: FakeChild[] = [];
  const timers: FakeTimer[] = [];
  const diagnostics = createDesktopDiagnostics();
  let time = 0;

  const deps: CoreProcessDeps = {
    fork(...args: [string, NodeJS.ProcessEnv]) {
      calls.push(args);
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    setTimer(callback, ms) {
      const timer: FakeTimer = { callback, ms, cancelled: false, fired: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    now: () => time,
    createToken: () => 'fixed-token',
    diagnostics,
  };

  return {
    deps,
    calls,
    diagnostics,
    timers,
    child(index = 0): FakeChild {
      const child = children[index];
      if (!child) throw new Error(`no child at index ${index}`);
      return child;
    },
    fireTimer(ms: number): void {
      const timer = timers.find((candidate) => candidate.ms === ms && !candidate.cancelled && !candidate.fired);
      if (!timer) throw new Error(`no pending timer for ${ms}`);
      timer.fired = true;
      timer.callback();
    },
  };
}

function createLaunch(): CoreLaunch {
  return {
    entry: '/core/main.js',
    env: { PATH: '/usr/bin' },
    start: {
      dataDir: '/data',
      port: 0,
      clientDir: '/client',
      clientOrigin: null,
      logLevel: 'info',
      dev: false,
    },
  };
}

describe('createCoreProcess', () => {
  it('发 start 时带令牌，不带命令行参数', () => {
    const harness = createHarness();
    const core = createCoreProcess(harness.deps);

    void core.start(createLaunch());

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0]).toHaveLength(2);
    expect(harness.calls[0]).toEqual(['/core/main.js', { PATH: '/usr/bin' }]);
    expect(harness.child().messages).toEqual([
      {
        type: 'start',
        token: 'fixed-token',
        dataDir: '/data',
        port: 0,
        clientDir: '/client',
        clientOrigin: null,
        logLevel: 'info',
        dev: false,
      },
    ]);
  });

  it('收到 ready 后返回端口并开始转发诊断', async () => {
    const harness = createHarness();
    const core = createCoreProcess(harness.deps);
    harness.diagnostics.record({
      event: 'desktop.started',
      level: 'info',
      data: { packaged: false, dev: false, platform: 'darwin' },
    });

    const pending = core.start(createLaunch());
    harness.child().emitMessage({ type: 'ready', port: 4567, appearance });

    await expect(pending).resolves.toEqual({ ok: true, port: 4567, token: 'fixed-token', appearance });
    expect(harness.child().messages.filter((message) => message.type === 'log')).toEqual([
      {
        type: 'log',
        entry: {
          kind: 'event',
          event: 'desktop.started',
          level: 'info',
          data: { packaged: false, dev: false, platform: 'darwin' },
        },
      },
      {
        type: 'log',
        entry: {
          kind: 'sample',
          metric: 'desktop.core_ready',
          durationMs: 0,
          outcome: 'ok',
          attempt: 1,
        },
      },
    ]);
  });

  it('start-failed 带回诊断编号并结束子进程', async () => {
    const harness = createHarness();
    const core = createCoreProcess(harness.deps);

    const pending = core.start(createLaunch());
    harness.child().emitMessage({ type: 'start-failed', reason: 'data_locked', diagnosticId });

    await expect(pending).resolves.toEqual({ ok: false, reason: 'data_locked', diagnosticId });
    expect(harness.child().killCount).toBe(1);
  });

  it('就绪超时', async () => {
    const harness = createHarness();
    const core = createCoreProcess(harness.deps);

    const pending = core.start(createLaunch());
    harness.fireTimer(CORE_READY_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout', diagnosticId: null });
    expect(harness.child().killCount).toBe(1);
  });

  it('启动中退出', async () => {
    const harness = createHarness();
    const core = createCoreProcess(harness.deps);

    const pending = core.start(createLaunch());
    harness.child().emitExit(1);

    await expect(pending).resolves.toEqual({ ok: false, reason: 'exited', diagnosticId: null });
  });

  it('运行中意外退出通知调用方', async () => {
    const harness = createHarness();
    const core = createCoreProcess(harness.deps);
    const codes: Array<number | null> = [];
    core.onUnexpectedExit((code) => codes.push(code));

    const pending = core.start(createLaunch());
    harness.child().emitMessage({ type: 'ready', port: 4567, appearance });
    await pending;
    harness.child().emitExit(137);

    expect(codes).toEqual([137]);
  });

  it('主动停止不算意外退出', async () => {
    const harness = createHarness();
    const core = createCoreProcess(harness.deps);
    const codes: Array<number | null> = [];
    core.onUnexpectedExit((code) => codes.push(code));

    const pending = core.start(createLaunch());
    harness.child().emitMessage({ type: 'ready', port: 4567, appearance });
    await pending;

    const stopped = core.stop();

    expect(harness.child().messages.at(-1)).toEqual({ type: 'stop' });
    harness.child().emitExit(0);
    await stopped;
    expect(codes).toEqual([]);
  });

  it('停止超时后强制结束', () => {
    const harness = createHarness();
    const core = createCoreProcess(harness.deps);

    const pending = core.start(createLaunch());
    harness.child().emitMessage({ type: 'ready', port: 4567, appearance });

    const stopped = core.stop();
    harness.fireTimer(CORE_STOP_TIMEOUT_MS);

    expect(stopped).toBeInstanceOf(Promise);
    expect(pending).toBeInstanceOf(Promise);
    expect(harness.child().killCount).toBe(1);
  });

  it('启动中停止会取消就绪计时器', async () => {
    const harness = createHarness();
    const core = createCoreProcess(harness.deps);

    void core.start(createLaunch());
    const stopped = core.stop();

    const readyTimer = harness.timers.find((timer) => timer.ms === CORE_READY_TIMEOUT_MS);
    expect(readyTimer?.cancelled).toBe(true);
    expect(harness.child().messages.at(-1)).toEqual({ type: 'stop' });

    harness.child().emitExit(0);
    await stopped;
  });

  it('旧子进程的退出不影响新的一次启动', async () => {
    const harness = createHarness();
    const core = createCoreProcess(harness.deps);

    const first = core.start(createLaunch());
    const firstChild = harness.child(0);
    firstChild.emitMessage({ type: 'start-failed', reason: 'data_locked', diagnosticId });
    await expect(first).resolves.toMatchObject({ ok: false });

    const second = core.start(createLaunch());
    const secondChild = harness.child(1);
    firstChild.emitExit(0);
    secondChild.emitMessage({ type: 'ready', port: 5001, appearance });

    await expect(second).resolves.toEqual({ ok: true, port: 5001, token: 'fixed-token', appearance });
  });
});
