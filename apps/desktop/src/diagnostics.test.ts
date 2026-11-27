import type { DesktopLogEntry } from '@unwritten/contracts/desktop';
import { describe, expect, it } from 'vitest';
import { DESKTOP_LOG_BUFFER_MAX, createDesktopDiagnostics } from './diagnostics.ts';

describe('createDesktopDiagnostics', () => {
  it('连接前缓存，连接后按顺序发出', () => {
    const diagnostics = createDesktopDiagnostics();
    const sent: DesktopLogEntry[] = [];

    diagnostics.record({
      event: 'desktop.started',
      level: 'info',
      data: { packaged: false, dev: true, platform: 'darwin' },
    });
    diagnostics.sample({ metric: 'desktop.core_ready', durationMs: 25, outcome: 'ok', attempt: 1 });
    diagnostics.attach((entry) => sent.push(entry));

    expect(sent).toEqual([
      {
        kind: 'event',
        event: 'desktop.started',
        level: 'info',
        data: { packaged: false, dev: true, platform: 'darwin' },
      },
      { kind: 'sample', metric: 'desktop.core_ready', durationMs: 25, outcome: 'ok', attempt: 1 },
    ]);
  });

  it('缓存满了计数，连接时先发 dropped', () => {
    const diagnostics = createDesktopDiagnostics();
    const sent: DesktopLogEntry[] = [];

    for (let index = 0; index < DESKTOP_LOG_BUFFER_MAX + 3; index += 1) {
      diagnostics.record({ event: 'desktop.core_ready_timeout', level: 'error', data: {} });
    }
    diagnostics.attach((entry) => sent.push(entry));

    expect(sent).toHaveLength(DESKTOP_LOG_BUFFER_MAX + 1);
    expect(sent[0]).toEqual({
      kind: 'event',
      event: 'desktop.dropped',
      level: 'warn',
      data: { count: 3 },
    });
    expect(sent.slice(1)).toHaveLength(DESKTOP_LOG_BUFFER_MAX);
  });

  it('断开后回到缓存', () => {
    const diagnostics = createDesktopDiagnostics();
    const sent: DesktopLogEntry[] = [];

    diagnostics.attach((entry) => sent.push(entry));
    diagnostics.detach();
    diagnostics.record({ event: 'desktop.core_ready_timeout', level: 'error', data: {} });

    expect(sent).toHaveLength(0);

    diagnostics.attach((entry) => sent.push(entry));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'event', event: 'desktop.core_ready_timeout' });
  });
});
