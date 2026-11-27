import { beforeEach, describe, expect, it } from 'vitest';
import { AppearanceSchema, DEFAULT_APPEARANCE } from '@unwritten/contracts';
import { applyAppearance, readAppearance } from './appearance.ts';

describe('applyAppearance', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'startViewTransition', { value: undefined, configurable: true });
    applyAppearance(DEFAULT_APPEARANCE);
    document.documentElement.removeAttribute('data-uw-theme');
    document.documentElement.removeAttribute('data-uw-theme-switching');
  });

  it('写入具体主题，不写入 system', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, appearance: 'light' });
    expect(document.documentElement.getAttribute('data-uw-theme')).toBe('light');
    applyAppearance({ ...DEFAULT_APPEARANCE, appearance: 'dark' });
    expect(document.documentElement.getAttribute('data-uw-theme')).toBe('dark');
  });

  it('切换到同一主题时不改变属性', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, appearance: 'light' });
    applyAppearance({ ...DEFAULT_APPEARANCE, appearance: 'light' });
    expect(document.documentElement.getAttribute('data-uw-theme')).toBe('light');
  });

  it('写入阅读偏好的五个属性', () => {
    applyAppearance({
      appearance: 'dark',
      proseSize: '4',
      proseFont: 'sans',
      proseLeading: 'compact',
      proseLayout: 'chat',
      proseIndent: '0',
    });
    expect(document.documentElement.getAttribute('data-uw-prose-size')).toBe('4');
    expect(document.documentElement.getAttribute('data-uw-prose-font')).toBe('sans');
    expect(document.documentElement.getAttribute('data-uw-prose-leading')).toBe('compact');
    expect(document.documentElement.getAttribute('data-uw-prose-layout')).toBe('chat');
    expect(document.documentElement.getAttribute('data-uw-prose-indent')).toBe('0');
    expect(readAppearance()).toEqual({
      appearance: 'dark',
      proseSize: '4',
      proseFont: 'sans',
      proseLeading: 'compact',
      proseLayout: 'chat',
      proseIndent: '0',
    });
  });

  it('每项偏好的每个取值写进根元素后都能原样读回', () => {
    const fields = Object.entries(AppearanceSchema.shape);
    expect(fields.length).toBeGreaterThan(0);
    for (const [field, schema] of fields) {
      expect(schema.options.length).toBeGreaterThan(1);
      for (const option of schema.options) {
        applyAppearance({ ...DEFAULT_APPEARANCE, [field]: option });
        expect(readAppearance()).toEqual({ ...DEFAULT_APPEARANCE, [field]: option });
      }
    }
  });

  it('根元素上的值不合法时读成默认值', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, proseIndent: '0', proseLayout: 'chat' });
    document.documentElement.setAttribute('data-uw-prose-indent', '9');
    document.documentElement.removeAttribute('data-uw-prose-size');
    expect(readAppearance()).toEqual({ ...DEFAULT_APPEARANCE, proseLayout: 'chat' });
  });
});
