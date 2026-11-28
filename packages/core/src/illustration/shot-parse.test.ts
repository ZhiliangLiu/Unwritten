import { describe, expect, it } from 'vitest';
import { parseShotText } from './shot-parse.ts';

describe('parseShotText', () => {
  it('五个标签都解析成去首尾空白的值', () => {
    const parsed = parseShotText(
      [
        'PROMPT: A short-haired figure holds out a brass key.',
        'NEGATIVE: blurry edges',
        'CAPTION: 修表匠把钥匙递到半空。',
        'REFS: C1:full_body,C2:three_quarter',
        'ASPECT: 3:2',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      ok: true,
      fields: {
        PROMPT: 'A short-haired figure holds out a brass key.',
        NEGATIVE: 'blurry edges',
        CAPTION: '修表匠把钥匙递到半空。',
        REFS: 'C1:full_body,C2:three_quarter',
        ASPECT: '3:2',
      },
    });
  });

  it('同一标签出现两次时报错，并只报一次', () => {
    const parsed = parseShotText(['PROMPT: first', 'PROMPT: second', 'PROMPT: third', 'CAPTION: 说明。'].join('\n'));
    expect(parsed).toEqual({ ok: false, errors: ['每个标签只写一次。'] });
  });

  it('不是标签的非空行报格式错误', () => {
    const parsed = parseShotText(['PROMPT: a picture', '这不是标签', 'CAPTION: 说明。'].join('\n'));
    expect(parsed).toEqual({ ok: false, errors: ['每个字段单独占一行，使用规定的英文标签、冒号和空格。'] });
  });

  it('去掉首尾成对的 Markdown 代码围栏', () => {
    const parsed = parseShotText(['```text', 'PROMPT: a picture', 'CAPTION: 说明。', 'REFS:', '```'].join('\n'));
    expect(parsed).toEqual({ ok: true, fields: { PROMPT: 'a picture', CAPTION: '说明。', REFS: '' } });
  });

  it('只有一头围栏时按格式错误处理，不剥掉围栏', () => {
    const parsed = parseShotText(['PROMPT: a picture', 'CAPTION: 说明。', '```'].join('\n'));
    expect(parsed).toEqual({ ok: false, errors: ['每个字段单独占一行，使用规定的英文标签、冒号和空格。'] });
  });

  it('REFS 后面没有内容时记为空字符串', () => {
    const parsed = parseShotText(['PROMPT: a picture', 'CAPTION: 说明。', 'REFS:'].join('\n'));
    expect(parsed).toEqual({ ok: true, fields: { PROMPT: 'a picture', CAPTION: '说明。', REFS: '' } });
  });
});
