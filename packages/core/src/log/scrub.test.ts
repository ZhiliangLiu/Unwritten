import { describe, expect, it } from 'vitest';
import { scrubSecrets } from './scrub.ts';

describe('scrubSecrets', () => {
  it('替换已知 key', () => {
    expect(scrubSecrets('key is super-secret-value', ['super-secret-value'])).toBe('key is [redacted]');
  });

  it('替换 sk- 开头的长串', () => {
    expect(scrubSecrets('token sk-abcdefgh12345678', [])).toBe('token [redacted]');
  });

  it('替换 Bearer token', () => {
    expect(scrubSecrets('Authorization: Bearer abc.def-123', [])).toBe('Authorization: [redacted]');
  });

  it('不相关的文字不变', () => {
    expect(scrubSecrets('雨夜修钟铺', [])).toBe('雨夜修钟铺');
  });
});
