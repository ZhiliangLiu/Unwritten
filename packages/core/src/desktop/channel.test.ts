import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CoreToDesktop } from '@unwritten/contracts/desktop';
import type { RunningCore } from '../app.ts';
import { startCore } from '../app.ts';
import type { ServiceFactories } from '../services.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createLibraryService } from '../library/service.ts';
import { createSettingsService } from '../settings/service.ts';
import { createSummaryService } from '../summary/queue.ts';
import { createAuthoringService } from '../authoring/service.ts';
import { createPlayService } from '../play/service.ts';
import { createImageService } from '../image/service.ts';
import { createIllustrationService } from '../illustration/service.ts';
import type { ParentPortLike } from './channel.ts';
import { attachDesktopChannel, waitForStart } from './channel.ts';

const token = 'a'.repeat(43);

const lightAppearance = {
  appearance: 'light',
  proseSize: '3',
  proseFont: 'serif',
  proseLeading: 'comfortable',
  proseLayout: 'book',
  proseIndent: '2',
} as const;

const darkAppearance = { ...lightAppearance, appearance: 'dark' } as const;

const desktopStarted = {
  kind: 'event',
  event: 'desktop.started',
  level: 'info',
  data: { packaged: false, dev: true, platform: 'darwin' },
};

function startMessage(dataDir: string) {
  return {
    type: 'start',
    dataDir,
    token,
    port: 0,
    clientDir: join(dataDir, 'client'),
    clientOrigin: null,
    logLevel: 'error',
  };
}

function createFakePort() {
  const listeners: Array<(event: { data: unknown }) => void> = [];
  const messages: CoreToDesktop[] = [];
  return {
    messages,
    on(_event: 'message', listener: (event: { data: unknown }) => void) {
      listeners.push(listener);
    },
    postMessage(message: CoreToDesktop) {
      messages.push(message);
    },
    emit(data: unknown) {
      for (const listener of listeners) listener({ data });
    },
  } satisfies ParentPortLike & { messages: CoreToDesktop[]; emit(data: unknown): void };
}

async function bootCore(): Promise<{
  temp: { dir: string; cleanup(): void };
  core: RunningCore;
  dataDir: string;
}> {
  const temp = makeTempDataDir();
  const clientDir = join(temp.dir, 'client');
  mkdirSync(clientDir);
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html><html lang="zh-CN"><head></head><body></body></html>');
  writeFileSync(join(clientDir, 'boot.inline.js'), '');
  const llm = createScriptedLlm();
  llm.pruneCalls = () => 0;
  const factories: ServiceFactories = {
    llm: () => llm,
    image: createImageService,
    illustration: createIllustrationService,
    library: createLibraryService,
    settings: createSettingsService,
    summary: createSummaryService,
    authoring: createAuthoringService,
    play: createPlayService,
  };
  const dataDir = join(temp.dir, 'data');
  const core = await startCore({ dataDir, port: 0, clientDir, clientOrigin: null, logLevel: 'info' }, factories);
  return { temp, core, dataDir };
}

function openDiagnostics(dataDir: string): DatabaseSync {
  return new DatabaseSync(join(dataDir, 'diagnostics.db'));
}

describe('waitForStart', () => {
  it('第一条合法的 start 之前的消息被计数后忽略', async () => {
    const port = createFakePort();
    const pending = waitForStart(port);
    port.emit({ type: 'log', entry: desktopStarted });
    port.emit({ type: 'start', token: 'x' });
    port.emit(startMessage('/tmp/first'));
    port.emit(startMessage('/tmp/second'));
    const { start, invalid } = await pending;
    expect(invalid).toBe(2);
    expect(start.dataDir).toBe('/tmp/first');
  });

  it('clientOrigin 不是合法源时同样算作不合法', async () => {
    const port = createFakePort();
    const pending = waitForStart(port);
    port.emit({ ...startMessage('/tmp/bad-origin'), clientOrigin: 'file:///tmp/client' });
    port.emit(startMessage('/tmp/good'));
    const { start, invalid } = await pending;
    expect(invalid).toBe(1);
    expect(start.dataDir).toBe('/tmp/good');
  });
});

describe('attachDesktopChannel', () => {
  it('就绪消息带实际端口和存下的外观', async () => {
    const { temp, core } = await bootCore();
    try {
      core.services.settings.update({ ...darkAppearance });
      const port = createFakePort();
      const detach = attachDesktopChannel({ port, core, invalidBeforeStart: 0, onStop: () => {} });
      expect(port.messages[0]).toEqual({ type: 'ready', port: core.port, appearance: { ...darkAppearance } });
      detach();
    } finally {
      await core.close();
      temp.cleanup();
    }
  });

  it('外观变化转发给 desktop', async () => {
    const { temp, core } = await bootCore();
    try {
      const port = createFakePort();
      const detach = attachDesktopChannel({ port, core, invalidBeforeStart: 0, onStop: () => {} });
      core.services.settings.update({ ...lightAppearance });
      await new Promise((resolve) => setImmediate(resolve));
      expect(port.messages).toContainEqual({ type: 'appearance-changed', appearance: { ...lightAppearance } });
      detach();
    } finally {
      await core.close();
      temp.cleanup();
    }
  });

  it('desktop 的事件写进诊断库', async () => {
    const { temp, core, dataDir } = await bootCore();
    try {
      const port = createFakePort();
      const detach = attachDesktopChannel({ port, core, invalidBeforeStart: 0, onStop: () => {} });
      port.emit({ type: 'log', entry: desktopStarted });
      await core.services.logger.flush();
      const diagnostics = openDiagnostics(dataDir);
      try {
        const rows = diagnostics
          .prepare("select module, event, data from diagnostic_events where event = 'desktop.started'")
          .all() as Array<{ module: string; event: string; data: string }>;
        expect(rows).toHaveLength(1);
        expect(rows[0]?.module).toBe('desktop');
        expect(JSON.parse(String(rows[0]?.data)).dev).toBe(true);
      } finally {
        diagnostics.close();
      }
      detach();
    } finally {
      await core.close();
      temp.cleanup();
    }
  });

  it('desktop 的样本 source 为 desktop', async () => {
    const { temp, core, dataDir } = await bootCore();
    try {
      const port = createFakePort();
      const detach = attachDesktopChannel({ port, core, invalidBeforeStart: 0, onStop: () => {} });
      port.emit({
        type: 'log',
        entry: { kind: 'sample', metric: 'desktop.core_ready', durationMs: 12, outcome: 'ok', attempt: 1 },
      });
      await core.services.logger.flush();
      const diagnostics = openDiagnostics(dataDir);
      try {
        const rows = diagnostics
          .prepare("select source, attempt from performance_samples where metric = 'desktop.core_ready'")
          .all() as Array<{ source: string; attempt: number }>;
        expect(rows).toEqual([{ source: 'desktop', attempt: 1 }]);
      } finally {
        diagnostics.close();
      }
      detach();
    } finally {
      await core.close();
      temp.cleanup();
    }
  });

  it('不合法的 log 只记一条 invalid，不写别的', async () => {
    const { temp, core, dataDir } = await bootCore();
    try {
      const port = createFakePort();
      const detach = attachDesktopChannel({ port, core, invalidBeforeStart: 0, onStop: () => {} });
      port.emit({ type: 'log', entry: desktopStarted });
      port.emit({ type: 'log', entry: { kind: 'event', event: 'desktop.secret', level: 'info', data: {} } });
      await core.services.logger.flush();
      const diagnostics = openDiagnostics(dataDir);
      try {
        const count = (event: string) => {
          const row = diagnostics
            .prepare('select count(*) as total from diagnostic_events where event = ?')
            .get(event) as { total: number } | undefined;
          return row?.total;
        };
        expect(count('desktop.started')).toBe(1);
        expect(count('desktop.channel.invalid')).toBe(1);
        expect(count('desktop.secret')).toBe(0);
      } finally {
        diagnostics.close();
      }
      detach();
    } finally {
      await core.close();
      temp.cleanup();
    }
  });

  it('start 之前的不合法消息记进诊断库', async () => {
    const { temp, core, dataDir } = await bootCore();
    try {
      const port = createFakePort();
      const detach = attachDesktopChannel({ port, core, invalidBeforeStart: 2, onStop: () => {} });
      await core.services.logger.flush();
      const diagnostics = openDiagnostics(dataDir);
      try {
        const row = diagnostics
          .prepare("select data from diagnostic_events where event = 'desktop.channel.invalid'")
          .get() as { data: string } | undefined;
        expect(JSON.parse(String(row?.data))).toEqual({ kind: 'start', issues: 2 });
      } finally {
        diagnostics.close();
      }
      detach();
    } finally {
      await core.close();
      temp.cleanup();
    }
  });

  it('stop 只触发一次 onStop', async () => {
    const { temp, core } = await bootCore();
    try {
      const port = createFakePort();
      let stops = 0;
      const detach = attachDesktopChannel({
        port,
        core,
        invalidBeforeStart: 0,
        onStop: () => {
          stops += 1;
        },
      });
      port.emit({ type: 'stop' });
      port.emit({ type: 'stop' });
      expect(stops).toBe(1);
      detach();
    } finally {
      await core.close();
      temp.cleanup();
    }
  });
});
