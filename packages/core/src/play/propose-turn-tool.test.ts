import { describe, expect, it } from 'vitest';
import { parseProposeTurnArgs } from './propose-turn-tool.ts';

const valid = {
  prose: '你推开门。雨声更大了。',
  options: '{"text":"走进雨里"}\n{"text":"关上门"}',
  changes: JSON.stringify({ type: 'scene', place: '门外', time: '深夜', present: '学徒' }),
  ending: 'false',
};

describe('parseProposeTurnArgs', () => {
  it('接受合格参数并返回草稿', () => {
    const result = parseProposeTurnArgs(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prose).toBe('你推开门。雨声更大了。');
      expect(result.value.paragraphs).toHaveLength(1);
      expect(result.value.options).toHaveLength(2);
      expect(result.value.changesRaw).toBe(valid.changes);
    }
  });

  it('changes 可以为空', () => {
    const result = parseProposeTurnArgs({ ...valid, changes: '' });
    expect(result.ok).toBe(true);
  });

  it('拒绝结束、未知字段和越界内容', () => {
    expect(parseProposeTurnArgs({ ...valid, ending: 'true' }).ok).toBe(false);
    expect(parseProposeTurnArgs({ ...valid, prose: '' }).ok).toBe(false);
    expect(parseProposeTurnArgs({ ...valid, options: '' }).ok).toBe(false);
    expect(parseProposeTurnArgs({ ...valid, ending: 1 }).ok).toBe(false);
  });
});
