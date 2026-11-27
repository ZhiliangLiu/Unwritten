import { describe, expect, it } from 'vitest';
import zhCN from './i18n/zh-CN.json' with { type: 'json' };
import { DESKTOP_STRING_KEYS, t, type DesktopStringKey } from './strings.ts';

function flatten(value: unknown, prefix: string[] = []): string[] {
  if (typeof value !== 'object' || value === null) return [prefix.join('.')];
  return Object.entries(value).flatMap(([key, child]) => flatten(child, [...prefix, key]));
}

describe('desktop strings', () => {
  it('每个键都能取到文字', () => {
    expect(DESKTOP_STRING_KEYS.length).toBeGreaterThan(0);
    for (const key of DESKTOP_STRING_KEYS) {
      expect(t(key).length).toBeGreaterThan(0);
    }
  });

  it('JSON 里没有多余的键', () => {
    const jsonKeys = flatten(zhCN).map((key) => `desktop:${key}`);
    expect(jsonKeys.sort()).toEqual([...DESKTOP_STRING_KEYS].sort());
  });

  it('插值替换变量', () => {
    expect(t('desktop:startup.diagnostic', { id: 'abc' })).toContain('abc');
  });

  it('未知键抛错', () => {
    expect(() => t('desktop:missing.key' as DesktopStringKey)).toThrow();
  });
});
