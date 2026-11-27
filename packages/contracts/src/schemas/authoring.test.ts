import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORK_SETTINGS,
  PlanItemSchema,
  ProtagonistFieldSchema,
  PURPOSES,
  PurposeSchema,
  StartPlaythroughInputSchema,
  StatusValueSchema,
  WorkSettingsSchema,
} from '../index.ts';

const field = (overrides: Record<string, unknown> = {}) => ({
  name: '名字',
  defaultValue: '阿岚',
  isName: true,
  ...overrides,
});

describe('authoring contracts', () => {
  it('主角填写项的名字不能含花括号、点和空白', () => {
    expect(ProtagonistFieldSchema.safeParse(field()).success).toBe(true);
    expect(ProtagonistFieldSchema.safeParse(field({ name: '主角.名' })).success).toBe(false);
    expect(ProtagonistFieldSchema.safeParse(field({ name: 'a b' })).success).toBe(false);
    expect(ProtagonistFieldSchema.safeParse(field({ name: '{x}' })).success).toBe(false);
  });

  it('最多一个填写项是主角名', () => {
    const twoNames = {
      ...DEFAULT_WORK_SETTINGS,
      protagonist: { text: '', fields: [field(), field({ name: '职业', isName: true })] },
    };
    expect(WorkSettingsSchema.safeParse(twoNames).success).toBe(false);
    const oneName = {
      ...DEFAULT_WORK_SETTINGS,
      protagonist: { text: '', fields: [field()] },
    };
    expect(WorkSettingsSchema.safeParse(oneName).success).toBe(true);
  });

  it('填写项名字不能重复', () => {
    const duplicate = {
      ...DEFAULT_WORK_SETTINGS,
      protagonist: { text: '', fields: [field({ isName: false }), field({ isName: true })] },
    };
    expect(WorkSettingsSchema.safeParse(duplicate).success).toBe(false);
  });

  it('方案项按 kind 区分字段', () => {
    const missingRole = {
      id: 'e1',
      source: 'ai',
      kind: 'entity',
      entityKind: 'character',
      name: '林潮',
      knownAs: null,
      profile: '',
      slot: null,
    };
    expect(PlanItemSchema.safeParse(missingRole).success).toBe(false);
    const secretWithRole = {
      id: 's1',
      source: 'ai',
      kind: 'secret',
      title: '旧信',
      statement: '旧信没有收件人。',
      subjectId: null,
      knowerIds: [],
      reveal: '',
      role: 'protagonist',
    };
    const parsed = PlanItemSchema.parse(secretWithRole);
    expect(parsed.kind).toBe('secret');
    expect('role' in parsed).toBe(false);
  });

  it('默认设定能通过校验', () => {
    const parsed = WorkSettingsSchema.parse(DEFAULT_WORK_SETTINGS);
    expect(parsed.cast.mode).toBe('fixed');
    expect(parsed.actions.hints).toBe('actions_only');
  });

  it('状态值视图按显示方式区分', () => {
    expect(StatusValueSchema.safeParse({ display: 'stage', stage: '相识', step: 2 }).success).toBe(false);
    expect(
      StatusValueSchema.safeParse({ display: 'stage', stage: '相识', step: 2, total: 4, previousStep: null }).success,
    ).toBe(true);
  });

  it('填写值不能含换行', () => {
    const input = {
      workId: '3b6f5d0a-8f4e-4c1e-9a7e-2d5c8b3a1f60',
      playthroughId: '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
      protagonist: { 名字: '阿\n\n岚' },
    };
    expect(StartPlaythroughInputSchema.safeParse(input).success).toBe(false);
    expect(StartPlaythroughInputSchema.safeParse({ ...input, protagonist: { 名字: '阿岚' } }).success).toBe(true);
  });

  it('用途列表包含 author_chat', () => {
    expect(PURPOSES.includes('author_chat')).toBe(true);
    expect(PurposeSchema.safeParse('author_chat').success).toBe(true);
  });
});
