import { describe, expect, it } from 'vitest';
import {
  AppearanceTextSchema,
  IllustrationStyleSchema,
  PORTRAIT_SLOTS,
  PortraitSetViewSchema,
} from './illustration.ts';

const slot = { slot: 'front', image: null, source: null, needsReview: false, task: null };

function portraitSet(slots: unknown[]) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workId: '00000000-0000-4000-8000-000000000002',
    scope: 'work',
    entityId: 'entity-1',
    state: 'draft',
    draftRev: 0,
    appearance: '一身洗旧的蓝外套。',
    slots,
    updatedAt: 1,
  };
}

describe('illustration schemas', () => {
  it('自定义画风不能为空、不能换行、不能超过 200 字', () => {
    expect(IllustrationStyleSchema.safeParse({ kind: 'custom', text: '' }).success).toBe(false);
    expect(IllustrationStyleSchema.safeParse({ kind: 'custom', text: 'a\nb' }).success).toBe(false);
    expect(IllustrationStyleSchema.safeParse({ kind: 'custom', text: 'a'.repeat(201) }).success).toBe(false);
    expect(IllustrationStyleSchema.safeParse({ kind: 'custom', text: 'a'.repeat(200) }).success).toBe(true);
  });

  it('形象文字的边界', () => {
    expect(AppearanceTextSchema.safeParse('衣'.repeat(300)).success).toBe(true);
    expect(AppearanceTextSchema.safeParse('衣'.repeat(301)).success).toBe(false);
    expect(AppearanceTextSchema.safeParse('衣\n服').success).toBe(false);
  });

  it('参考组必须正好三个位置', () => {
    expect(PortraitSetViewSchema.safeParse(portraitSet([slot, slot])).success).toBe(false);
    expect(PortraitSetViewSchema.safeParse(portraitSet([slot, slot, slot])).success).toBe(true);
  });

  it('位置的字面量与设计一致', () => {
    expect(PORTRAIT_SLOTS).toEqual(['front', 'three_quarter', 'full_body']);
  });
});
