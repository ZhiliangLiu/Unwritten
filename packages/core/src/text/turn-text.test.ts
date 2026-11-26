import { describe, expect, it } from 'vitest';
import { normalizeProse, parseJsonLines, parseOptionLines, splitParagraphs } from './turn-text.ts';

describe('normalizeProse', () => {
  it('统一换行并压掉多余空行', () => {
    expect(normalizeProse('\r\n  第一段 \r\n\r\n\r\n第二段  \n')).toBe('第一段\n\n第二段');
  });
});

describe('splitParagraphs', () => {
  it('段落按空行切分，段号与数组下标加一对应', () => {
    expect(splitParagraphs('甲\n\n\n乙\n丙\n\n丁')).toEqual(['甲', '乙\n丙', '丁']);
  });
});

describe('parseJsonLines', () => {
  it('跳过空行并保留行号', () => {
    const result = parseJsonLines('{"a":1}\n\n{"b":2}', 'changes');
    expect(result).toEqual({
      ok: true,
      value: [
        { line: 1, value: { a: 1 } },
        { line: 3, value: { b: 2 } },
      ],
    });
  });

  it('报告不是 JSON 的行号', () => {
    const result = parseJsonLines('{"a":1}\n不是 JSON', 'changes');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('第 2 行');
  });

  it('拒绝不是对象的值', () => {
    const result = parseJsonLines('[1,2]', 'changes');
    expect(result.ok).toBe(false);
  });

  it('一行 JSON 数组展开成多行，行号按展开后的行数排', () => {
    expect(parseJsonLines('[{"a":1},{"b":2}]', 'changes')).toEqual({
      ok: true,
      value: [
        { line: 1, value: { a: 1 } },
        { line: 2, value: { b: 2 } },
      ],
    });
  });

  it('数组里的元素仍必须是对象，且行号与后续行不重复', () => {
    expect(parseJsonLines('[{"a":1},"b"]\n{"c":3}', 'changes')).toEqual({
      ok: false,
      errors: ['第 2 行 changes：必须是对象'],
    });
  });
});

describe('parseOptionLines', () => {
  const limits = { min: 1, max: 2, textMax: 5 };

  it('解析合格选项', () => {
    expect(parseOptionLines('{"text":"推门"}\n{"text":"离开"}', limits)).toEqual({
      ok: true,
      value: [{ text: '推门' }, { text: '离开' }],
    });
  });

  it('一行 JSON 数组等价于每个选项各占一行', () => {
    expect(parseOptionLines('[{"text":"推门"},{"text":"离开"}]', limits)).toEqual({
      ok: true,
      value: [{ text: '推门' }, { text: '离开' }],
    });
  });

  it('拒绝 hint、空文本、超长和条数越界', () => {
    expect(parseOptionLines('{"text":"推门","hint":"有风险"}', limits).ok).toBe(false);
    expect(parseOptionLines('{"text":"  "}', limits).ok).toBe(false);
    expect(parseOptionLines('{"text":"太长了啊啊啊"}', limits).ok).toBe(false);
    expect(parseOptionLines('{"text":"一"}\n{"text":"二"}\n{"text":"三"}', limits).ok).toBe(false);
  });
});
