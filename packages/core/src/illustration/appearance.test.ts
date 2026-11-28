import { describe, expect, it } from 'vitest';
import { appearanceHash } from './appearance.ts';

describe('appearanceHash', () => {
  it('首尾空白不同时哈希相同', () => {
    expect(appearanceHash('  短发，旧风衣  ')).toBe(appearanceHash('短发，旧风衣'));
  });

  it('组合字符和预组字符的哈希相同', () => {
    expect(appearanceHash('e\u0301')).toBe(appearanceHash('\u00e9'));
  });

  it('内容不同时哈希不同，且是 64 位小写十六进制', () => {
    const hash = appearanceHash('短发，旧风衣');
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(hash).not.toBe(appearanceHash('短发，新风衣'));
  });
});
