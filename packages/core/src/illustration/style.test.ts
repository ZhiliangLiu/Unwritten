import { describe, expect, it } from 'vitest';
import { DEFAULT_ILLUSTRATION_STYLE, STYLE_PRESETS } from '@unwritten/contracts';
import { STYLE_PRESET_PROMPTS, effectiveStyle, styleFragment, styleRecord } from './style.ts';

describe('style', () => {
  it('每个预设都有英文片段，自定义画风没有', () => {
    expect(STYLE_PRESETS.length).toBeGreaterThan(0);
    for (const preset of STYLE_PRESETS) {
      expect(STYLE_PRESET_PROMPTS[preset].trim()).not.toBe('');
      expect(styleFragment({ kind: 'preset', preset })).toBe(STYLE_PRESET_PROMPTS[preset]);
    }
    expect(STYLE_PRESET_PROMPTS.watercolor).toBe(
      'watercolor illustration, transparent washes, soft pigment edges, paper grain',
    );
    expect(styleFragment({ kind: 'custom', text: '水墨淡彩' })).toBeNull();
  });

  it('没存画风时回落到默认画风，存了就原样返回', () => {
    expect(effectiveStyle(null)).toEqual(DEFAULT_ILLUSTRATION_STYLE);
    expect(DEFAULT_ILLUSTRATION_STYLE).toEqual({ kind: 'preset', preset: 'painterly' });
    expect(effectiveStyle(undefined)).toBe(DEFAULT_ILLUSTRATION_STYLE);
    const stored = { kind: 'custom' as const, text: '旧照片的颗粒感' };
    expect(effectiveStyle(stored)).toBe(stored);
  });

  it('存进参考组的画风就是画风本身', () => {
    const style = { kind: 'preset' as const, preset: 'ink' as const };
    expect(styleRecord(style)).toBe(style);
  });
});
