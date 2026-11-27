import { PURPOSES, THINKING_FORMATS, THINKING_LEVELS } from '@unwritten/contracts';
import { describe, expect, it } from 'vitest';
import settings from '../../i18n/zh-CN/settings.json';
import {
  PROBLEM_LABEL_KEYS,
  PURPOSE_LABEL_KEYS,
  THINKING_FORMAT_LABEL_KEYS,
  THINKING_LEVEL_LABEL_KEYS,
} from './labels.ts';

function textOf(key: string): string {
  const path = key.replace(/^settings:/, '').split('.');
  let value: unknown = settings;
  for (const part of path) {
    if (!value || typeof value !== 'object') return '';
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : '';
}

function expectKeys(keys: string[]): void {
  for (const key of keys) expect(textOf(key), key).not.toBe('');
}

describe('settings labels', () => {
  it('枚举常量分别有 4、7、7 个值', () => {
    expect(PURPOSES.length).toBe(4);
    expect(THINKING_LEVELS.length).toBe(7);
    expect(THINKING_FORMATS.length).toBe(7);
  });

  it('每个用途都有非空文案', () => {
    expectKeys(PURPOSES.map((purpose) => PURPOSE_LABEL_KEYS[purpose]));
  });

  it('每个思考档位都有非空文案', () => {
    expectKeys(Object.values(THINKING_LEVEL_LABEL_KEYS));
  });

  it('每个思考写法都有非空文案', () => {
    expectKeys(THINKING_FORMATS.map((format) => THINKING_FORMAT_LABEL_KEYS[format]));
  });

  it('每个用途问题都有非空文案', () => {
    expectKeys(Object.values(PROBLEM_LABEL_KEYS));
  });
});
