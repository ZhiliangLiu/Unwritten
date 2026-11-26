import { describe, expect, it } from 'vitest';
import { parsePreviewArgs } from './preview-tool.ts';

const valid = {
  title: '雨夜修钟铺',
  blurb: '一个雨夜，你在钟铺里等一个人。',
  public_setting: '老城的钟铺，雨下了一整夜。',
  prose: '雨声盖住钟声。你抬头看向门口。\n\n门铃响了。',
  options: '{"text":"去开门"}\n{"text":"继续修钟"}',
  place: '钟铺',
  time: '深夜',
  language: 'zh-CN',
  present: '',
  changes:
    '{"type":"new_entity","kind":"character","name":"守夜人","known_as":"","profile":"","para":"1","protagonist":"true"}',
};

describe('parsePreviewArgs', () => {
  it('接受合格参数', () => {
    const result = parsePreviewArgs(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.preview.publicSetting).toBe(valid.public_setting);
      expect(result.value.preview.options).toHaveLength(2);
      expect(result.value.preview.scene).toEqual({ place: '钟铺', time: '深夜' });
      expect(result.value.preview.cast).toEqual([
        { kind: 'character', name: '守夜人', knownAs: null, profile: '', protagonist: true },
      ]);
    }
  });

  it('每条规则都有错误说明', () => {
    expect(parsePreviewArgs({ ...valid, title: '' }).ok).toBe(false);
    expect(parsePreviewArgs({ ...valid, prose: '' }).ok).toBe(false);
    expect(parsePreviewArgs({ ...valid, options: '' }).ok).toBe(false);
    expect(parsePreviewArgs({ ...valid, options: '{"text":"一","hint":"x"}' }).ok).toBe(false);
    expect(parsePreviewArgs({ ...valid, language: '不合法' }).ok).toBe(false);
    expect(parsePreviewArgs({ ...valid, title: 1 }).ok).toBe(false);
  });

  it('预览列出开场里出场的人物', () => {
    const result = parsePreviewArgs({
      ...valid,
      present: '撑伞的女人',
      changes:
        '{"type":"new_entity","kind":"character","name":"守夜人","known_as":"","profile":"","para":"1","protagonist":"true"}\n{"type":"new_entity","kind":"character","name":"沈岚","known_as":"撑伞的女人","profile":"带着黑伞","para":"1"}',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.preview.cast[0]?.protagonist).toBe(true);
      expect(result.value.preview.cast[1]).toMatchObject({ name: '沈岚', knownAs: '撑伞的女人' });
      expect(result.value.preview.scene).toEqual({ place: '钟铺', time: '深夜' });
    }
  });

  it('开场正文提前出现真名被拒绝', () => {
    const result = parsePreviewArgs({
      ...valid,
      prose: '沈岚推门进来。',
      changes:
        '{"type":"new_entity","kind":"character","name":"守夜人","known_as":"","profile":"","para":"1","protagonist":"true"}\n{"type":"new_entity","kind":"character","name":"沈岚","known_as":"撑伞的女人","profile":"带着黑伞","para":"1"}',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.includes('第 1 段'))).toBe(true);
  });

  it('失败时报告出错的字段', () => {
    const emptyTitle = parsePreviewArgs({ ...valid, title: '' });
    expect(emptyTitle.ok).toBe(false);
    if (!emptyTitle.ok) expect(emptyTitle.fields).toEqual(['title']);

    const leaked = parsePreviewArgs({
      ...valid,
      prose: '沈岚推门进来。',
      changes:
        '{"type":"new_entity","kind":"character","name":"守夜人","known_as":"","profile":"","para":"1","protagonist":"true"}\n{"type":"new_entity","kind":"character","name":"沈岚","known_as":"撐伞的女人","profile":"带着黑伞","para":"1"}',
    });
    expect(leaked.ok).toBe(false);
    if (!leaked.ok) expect(leaked.fields).toEqual(['leak']);
  });

  it('在场人物必须是本次新增的人物，并列出现有的人', () => {
    const result = parsePreviewArgs({ ...valid, present: '陌生人' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.includes('找不到「陌生人」'))).toBe(true);
      expect(result.errors.some((error) => error.includes('本次新增的人物'))).toBe(true);
    }
  });
});
