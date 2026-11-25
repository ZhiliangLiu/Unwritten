import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './errors.ts';
import { appearanceAttributes, DEFAULT_APPEARANCE } from './schemas/appearance.ts';

describe('ERROR_CODES', () => {
  it('没有重复', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('每一项都是 snake_case', () => {
    for (const code of ERROR_CODES) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
});

describe('appearanceAttributes', () => {
  it('默认值输出四个属性', () => {
    expect(appearanceAttributes(DEFAULT_APPEARANCE)).toBe(
      'data-uw-appearance="system" data-uw-prose-size="3" data-uw-prose-font="serif" data-uw-prose-leading="comfortable"',
    );
  });

  it('不在枚举里的值会抛错', () => {
    expect(() => appearanceAttributes({ ...DEFAULT_APPEARANCE, appearance: 'systemx' } as never)).toThrow();
  });
});
