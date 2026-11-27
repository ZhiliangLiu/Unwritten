import { ENTITY_KINDS, PLAN_ENTITY_ROLES, PLAN_SOURCES, PLAN_SUMMARY_KEYS, STATE_DISPLAYS } from '@unwritten/contracts';
import { describe, expect, it } from 'vitest';
import authoring from '../../i18n/zh-CN/authoring.json';
import {
  PLAN_ENTITY_KIND_LABEL_KEYS,
  PLAN_ENTITY_ROLE_LABEL_KEYS,
  PLAN_SOURCE_LABEL_KEYS,
  PLAN_SUMMARY_LABEL_KEYS,
  STATE_DISPLAY_LABEL_KEYS,
} from './plan-labels.ts';

function textOf(key: string): string {
  const path = key.replace(/^authoring:/, '').split('.');
  let value: unknown = authoring;
  for (const part of path) {
    if (!value || typeof value !== 'object') return '';
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : '';
}

function expectKeys(keys: string[]): void {
  for (const key of keys) expect(textOf(key), key).not.toBe('');
}

describe('plan labels', () => {
  it('枚举常量都非空', () => {
    expect(PLAN_SOURCES.length).toBeGreaterThan(0);
    expect(PLAN_SUMMARY_KEYS.length).toBeGreaterThan(0);
    expect(STATE_DISPLAYS.length).toBeGreaterThan(0);
    expect(PLAN_ENTITY_ROLES.length).toBeGreaterThan(0);
    expect(ENTITY_KINDS.length).toBeGreaterThan(0);
  });

  it('来源用文字区分', () => {
    expect(textOf(PLAN_SOURCE_LABEL_KEYS.author)).toBe('作者');
    expect(textOf(PLAN_SOURCE_LABEL_KEYS.ai)).toBe('AI 补全');
    expect(textOf(PLAN_SOURCE_LABEL_KEYS.author_confirmed)).toBe('作者确认');
  });

  it('每个摘要项都有非空文案', () => {
    expectKeys(PLAN_SUMMARY_KEYS.map((key) => PLAN_SUMMARY_LABEL_KEYS[key]));
  });

  it('每种显示方式都有非空文案', () => {
    expectKeys(STATE_DISPLAYS.map((display) => STATE_DISPLAY_LABEL_KEYS[display]));
  });

  it('每种人物身份都有非空文案', () => {
    expectKeys(PLAN_ENTITY_ROLES.map((role) => PLAN_ENTITY_ROLE_LABEL_KEYS[role]));
  });

  it('每种实体种类都有非空文案', () => {
    expectKeys(ENTITY_KINDS.map((kind) => PLAN_ENTITY_KIND_LABEL_KEYS[kind]));
  });
});
