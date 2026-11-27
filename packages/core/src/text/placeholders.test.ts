import { describe, expect, it } from 'vitest';
import {
  placeholderNames,
  placeholderToken,
  substitutePlaceholders,
  unknownPlaceholders,
  withoutPlaceholders,
} from './placeholders.ts';

describe('placeholders', () => {
  it('替换已知的填写项，保留未知的', () => {
    const text = '{{protagonist.名字}}背起{{protagonist.职业}}的邮袋，去找{{protagonist.年龄}}。';
    expect(placeholderToken('名字')).toBe('{{protagonist.名字}}');
    expect(substitutePlaceholders(text, { 名字: '阿岚', 职业: '邮差' })).toBe(
      '阿岚背起邮差的邮袋，去找{{protagonist.年龄}}。',
    );
    expect(placeholderNames(text)).toEqual(['名字', '职业', '年龄']);
  });

  it('找出作者没留的填写项', () => {
    expect(unknownPlaceholders('{{protagonist.名字}}和{{protagonist.年龄}}', ['名字', '职业'])).toEqual(['年龄']);
    expect(unknownPlaceholders('没有占位符', ['名字'])).toEqual([]);
  });

  it('去掉占位符之后不再有 {{', () => {
    const stripped = withoutPlaceholders('{{protagonist.名字}}推开门，{{protagonist.职业}}的徽章还在。');
    expect(stripped).toBe('推开门，的徽章还在。');
    expect(stripped).not.toContain('{{');
  });
});
