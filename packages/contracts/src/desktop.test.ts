import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CoreToDesktopSchema,
  DesktopEventEntrySchema,
  DesktopToCoreSchema,
  StartMessageSchema,
  TOKEN_PATTERN,
} from './desktop.ts';

const validStart = {
  type: 'start',
  dataDir: '/tmp/unwritten',
  token: randomBytes(32).toString('base64url'),
  port: 0,
  clientDir: '/tmp/client',
  clientOrigin: null,
  logLevel: 'info',
  dev: false,
};

describe('desktop contracts', () => {
  it('start 消息拒绝缺字段和多余字段', () => {
    const { token: _token, ...missingToken } = validStart;
    expect(StartMessageSchema.safeParse(missingToken).success).toBe(false);
    expect(StartMessageSchema.safeParse({ ...validStart, extra: true }).success).toBe(false);
    expect(StartMessageSchema.safeParse(validStart).success).toBe(true);
  });

  it('令牌格式固定为 43 位 base64url', () => {
    expect(randomBytes(32).toString('base64url')).toMatch(TOKEN_PATTERN);
    expect(StartMessageSchema.safeParse({ ...validStart, token: 'a'.repeat(42) }).success).toBe(false);
    expect(StartMessageSchema.safeParse({ ...validStart, token: `${'a'.repeat(42)}+` }).success).toBe(false);
  });

  it('desktop 事件按事件名限定字段', () => {
    expect(
      DesktopEventEntrySchema.safeParse({
        kind: 'event',
        event: 'desktop.started',
        level: 'info',
        data: { packaged: false, dev: true, platform: 'darwin' },
      }).success,
    ).toBe(true);
    expect(
      DesktopEventEntrySchema.safeParse({
        kind: 'event',
        event: 'desktop.started',
        level: 'info',
        data: { packaged: false, dev: true, platform: 'darwin', path: '/tmp' },
      }).success,
    ).toBe(false);
    expect(
      DesktopEventEntrySchema.safeParse({
        kind: 'event',
        event: 'desktop.core_exited',
        level: 'warn',
        data: { code: 1, phase: 'stopping' },
      }).success,
    ).toBe(false);
  });

  it('未知事件名被拒', () => {
    expect(
      DesktopEventEntrySchema.safeParse({
        kind: 'event',
        event: 'desktop.secret',
        level: 'info',
        data: {},
      }).success,
    ).toBe(false);
  });

  it('core → desktop 的三类消息都能解析', () => {
    const appearance = {
      appearance: 'system',
      proseSize: '3',
      proseFont: 'serif',
      proseLeading: 'comfortable',
      proseLayout: 'book',
      proseIndent: '2',
    };
    expect(CoreToDesktopSchema.safeParse({ type: 'ready', port: 4317, appearance }).success).toBe(true);
    expect(CoreToDesktopSchema.safeParse({ type: 'appearance-changed', appearance }).success).toBe(true);
    expect(
      CoreToDesktopSchema.safeParse({
        type: 'start-failed',
        reason: 'data_locked',
        diagnosticId: '3b6f5d0a-8f4e-4c1e-9a7e-2d5c8b3a1f60',
      }).success,
    ).toBe(true);
    expect(
      CoreToDesktopSchema.safeParse({
        type: 'start-failed',
        reason: 'timeout',
        diagnosticId: '3b6f5d0a-8f4e-4c1e-9a7e-2d5c8b3a1f60',
      }).success,
    ).toBe(false);
  });

  it('desktop → core 的 log 和 stop 都能解析', () => {
    expect(
      DesktopToCoreSchema.safeParse({
        type: 'log',
        entry: {
          kind: 'sample',
          metric: 'desktop.core_ready',
          durationMs: 120,
          outcome: 'ok',
          attempt: 1,
        },
      }).success,
    ).toBe(true);
    expect(DesktopToCoreSchema.safeParse({ type: 'stop' }).success).toBe(true);
  });

  it('desktop 入口不依赖主入口', () => {
    const source = readFileSync(new URL('./desktop.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('./index.ts');
    expect(source).not.toContain('procedures/');
  });
});
