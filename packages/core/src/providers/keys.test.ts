import { describe, expect, it } from 'vitest';
import { envVarOf, keyStatus, resolveApiKey } from './keys.ts';

describe('keys', () => {
  it('解析 $A 和 ${A}', () => {
    expect(envVarOf('$A')).toBe('A');
    expect(envVarOf('${A}')).toBe('A');
    expect(resolveApiKey('$A', { A: 'secret' })).toBe('secret');
    expect(resolveApiKey('明文', {})).toBe('明文');
  });

  it('变量未设置时不泄露值，并报告状态', () => {
    expect(resolveApiKey('$MISSING', {})).toBeUndefined();
    expect(keyStatus('$MISSING', {})).toEqual({ hasKey: false, source: 'env', envVar: 'MISSING' });
    expect(keyStatus('明文', {})).toEqual({ hasKey: true, source: 'file', envVar: null });
    expect(keyStatus(undefined, {})).toEqual({ hasKey: false, source: 'none', envVar: null });
  });
});
