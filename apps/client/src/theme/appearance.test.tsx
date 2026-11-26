import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '@unwritten/contracts';
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

  it('写入阅读偏好的三个属性', () => {
    applyAppearance({ appearance: 'dark', proseSize: '4', proseFont: 'sans', proseLeading: 'compact' });
    expect(document.documentElement.getAttribute('data-uw-prose-size')).toBe('4');
    expect(document.documentElement.getAttribute('data-uw-prose-font')).toBe('sans');
    expect(document.documentElement.getAttribute('data-uw-prose-leading')).toBe('compact');
    expect(readAppearance()).toEqual({
      appearance: 'dark',
      proseSize: '4',
      proseFont: 'sans',
      proseLeading: 'compact',
    });
  });
});
