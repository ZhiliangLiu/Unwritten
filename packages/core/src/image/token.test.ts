import { describe, expect, it } from 'vitest';
import { generateServiceToken } from './token.ts';

describe('generateServiceToken', () => {
  it('生成 43 个 URL 安全字符', () => {
    const token = generateServiceToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it('一千次不重复', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateServiceToken()));
    expect(tokens.size).toBe(1000);
  });
});
