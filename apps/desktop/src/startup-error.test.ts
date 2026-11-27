import { START_FAILURE_REASONS } from '@unwritten/contracts/desktop';
import { describe, expect, it } from 'vitest';
import type { DesktopStartFailure } from './core-process.ts';
import { crashDialog, startFailureDialog } from './startup-error.ts';

const reasons: DesktopStartFailure[] = [...START_FAILURE_REASONS, 'timeout', 'exited'];

describe('startFailureDialog', () => {
  it('每个启动失败原因都有文字', () => {
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      const dialog = startFailureDialog({ reason, diagnosticId: null });
      expect(dialog.message).not.toBe('');
    }
  });

  it('有诊断编号时 detail 含编号', () => {
    const dialog = startFailureDialog({ reason: 'startup', diagnosticId: 'abc-123' });
    expect(dialog.detail).toContain('abc-123');
  });

  it('按钮顺序是重试在前', () => {
    const dialog = startFailureDialog({ reason: 'startup', diagnosticId: null });
    expect(dialog.defaultId).toBe(0);
    expect(dialog.cancelId).toBe(1);
    expect(dialog.buttons[0]).toBe('重试');
    expect(dialog.buttons[1]).toBe('退出');
  });
});

describe('crashDialog', () => {
  it('意外退出给出重启和退出', () => {
    const dialog = crashDialog(1);
    expect(dialog.type).toBe('warning');
    expect(dialog.message).not.toBe('');
    expect(dialog.defaultId).toBe(0);
    expect(dialog.cancelId).toBe(1);
    expect(dialog.buttons[0]).toBe('重启');
    expect(dialog.buttons[1]).toBe('退出');
  });
});
