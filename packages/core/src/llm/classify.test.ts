import { describe, expect, it } from 'vitest';
import { classifyFailure } from './classify.ts';

const base = { httpStatus: null, redirected: false, timedOut: false, aborted: false, errorMessage: '' };

describe('classifyFailure', () => {
  it('按顺序归类', () => {
    expect(classifyFailure({ ...base, redirected: true })).toBe('redirected');
    expect(classifyFailure({ ...base, timedOut: true })).toBe('timeout');
    expect(classifyFailure({ ...base, aborted: true })).toBe('interrupted');
    expect(classifyFailure({ ...base, httpStatus: 401 })).toBe('unauthorized');
    expect(classifyFailure({ ...base, httpStatus: 403 })).toBe('unauthorized');
    expect(classifyFailure({ ...base, httpStatus: 429, errorMessage: 'quota exceeded' })).toBe('quota');
    expect(classifyFailure({ ...base, httpStatus: 429, errorMessage: 'rate limit' })).toBe('rate_limited');
    expect(classifyFailure({ ...base, httpStatus: 400, errorMessage: 'context too long' })).toBe('context_overflow');
    expect(classifyFailure({ ...base, httpStatus: 404 })).toBe('not_compatible');
    expect(classifyFailure({ ...base, httpStatus: 500 })).toBe('server');
    expect(classifyFailure({ ...base, errorMessage: 'timed out' })).toBe('timeout');
    expect(classifyFailure({ ...base, httpStatus: 200 })).toBe('network');
    expect(classifyFailure({ ...base, httpStatus: 418 })).toBe('server');
  });
});
