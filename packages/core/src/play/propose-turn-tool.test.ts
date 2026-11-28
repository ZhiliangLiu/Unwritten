import { describe, expect, it } from 'vitest';
import { estimateTokens } from '../llm/budget.ts';
import { PROPOSE_TURN_DESCRIPTION } from './narrator-prompt.ts';
import { PROPOSE_TURN_PARAMETERS, parseIllustrate, parseProposeTurnArgs } from './propose-turn-tool.ts';

const valid = {
  prose: '你推开门。雨声更大了。',
  options: '{"text":"走进雨里"}\n{"text":"关上门"}',
  changes: JSON.stringify({ type: 'scene', place: '门外', time: '深夜', present: '学徒' }),
  ending: 'false',
};

const ctx = { hintMode: 'actions_only' as const, endingAllowed: false };

describe('parseProposeTurnArgs', () => {
  it('接受合格参数并返回草稿', () => {
    const result = parseProposeTurnArgs(valid, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prose).toBe('你推开门。雨声更大了。');
      expect(result.value.paragraphs).toHaveLength(1);
      expect(result.value.options).toHaveLength(2);
      expect(result.value.changesRaw).toBe(valid.changes);
      expect(result.value.ending).toBe(false);
    }
  });

  it('changes 可以为空', () => {
    const result = parseProposeTurnArgs({ ...valid, changes: '' }, ctx);
    expect(result.ok).toBe(true);
  });

  it('拒绝结束、未知字段和越界内容', () => {
    expect(parseProposeTurnArgs({ ...valid, ending: 'true' }, ctx).ok).toBe(false);
    expect(parseProposeTurnArgs({ ...valid, prose: '' }, ctx).ok).toBe(false);
    expect(parseProposeTurnArgs({ ...valid, options: '' }, ctx).ok).toBe(false);
    expect(parseProposeTurnArgs({ ...valid, ending: 1 }, ctx).ok).toBe(false);
  });

  it('没有结束条件时不能完结', () => {
    const result = parseProposeTurnArgs({ ...valid, ending: 'true' }, { ...ctx, endingAllowed: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('这部作品没有结束条件，ending 只能填 "false"。');
  });

  it('有结束条件时可以完结', () => {
    const result = parseProposeTurnArgs({ ...valid, ending: 'true' }, { ...ctx, endingAllowed: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ending).toBe(true);
  });

  it('只显示行动的作品不接受提醒', () => {
    const options = '{"text":"走进雨里","hint":"雨里有人等你"}';
    const rejected = parseProposeTurnArgs({ ...valid, options }, { ...ctx, hintMode: 'actions_only' });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors).toContain('这部作品只显示行动，推荐行动不写 hint。');

    const accepted = parseProposeTurnArgs({ ...valid, options }, { ...ctx, hintMode: 'known_consequences' });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.value.options[0]?.hint).toBe('雨里有人等你');
  });
});

describe('parseIllustrate', () => {
  it('只接受 1 到正文段数之间的整数数字字符串', () => {
    expect(parseIllustrate('2', 3)).toBe(2);
    expect(parseIllustrate(' 2 ', 3)).toBe(2);
    expect(parseIllustrate('0', 3)).toBeNull();
    expect(parseIllustrate('4', 3)).toBeNull();
    expect(parseIllustrate('1.5', 3)).toBeNull();
    expect(parseIllustrate(' ', 3)).toBeNull();
    expect(parseIllustrate(2, 3)).toBeNull();
    expect(parseIllustrate(undefined, 3)).toBeNull();
  });
});

describe('parseProposeTurnArgs 插图标记', () => {
  it('把 illustrate 解析成段号，缺省为空', () => {
    const withMarker = parseProposeTurnArgs({ ...valid, prose: '你推开门。\n\n雨声更大了。', illustrate: '2' }, ctx);
    expect(withMarker.ok).toBe(true);
    if (withMarker.ok) expect(withMarker.value.illustratePara).toBe(2);

    const without = parseProposeTurnArgs(valid, ctx);
    expect(without.ok).toBe(true);
    if (without.ok) expect(without.value.illustratePara).toBeNull();
  });
});

describe('提案工具说明的 token 棘轮', () => {
  it('说明的长度在上限内', () => {
    expect(estimateTokens(`${JSON.stringify(PROPOSE_TURN_PARAMETERS)}${PROPOSE_TURN_DESCRIPTION}`)).toBeLessThanOrEqual(
      2000,
    );
  });
});
