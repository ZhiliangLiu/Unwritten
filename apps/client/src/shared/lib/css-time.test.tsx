import { describe, expect, it } from 'vitest';
import { readCssDuration } from './css-time.ts';

describe('readCssDuration', () => {
  it('解析毫秒和秒', () => {
    const element = document.createElement('div');
    document.body.append(element);
    element.style.setProperty('--uw-test-ms', '120ms');
    element.style.setProperty('--uw-test-s', '0.36s');
    expect(readCssDuration('--uw-test-ms', element)).toBe(120);
    expect(readCssDuration('--uw-test-s', element)).toBe(360);
    element.remove();
  });

  it('读不到时返回 0', () => {
    const element = document.createElement('div');
    expect(readCssDuration('--uw-test-missing', element)).toBe(0);
  });
});
