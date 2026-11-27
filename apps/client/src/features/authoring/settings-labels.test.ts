import { CAST_MODES, HINT_MODES, OPENING_MODES, SETTING_SECTION_IDS } from '@unwritten/contracts';
import { describe, expect, it } from 'vitest';
import authoring from '../../i18n/zh-CN/authoring.json';
import {
  CAST_MODE_LABEL_KEYS,
  HINT_MODE_LABEL_KEYS,
  OPENING_MODE_LABEL_KEYS,
  OPENING_PLACEHOLDER_KEYS,
  OPENING_TEXT_LABEL_KEYS,
  SETTING_SECTION_HEADING_KEYS,
  SETTING_SECTION_HELP_KEYS,
  SETTING_SECTION_PLACEHOLDER_KEYS,
} from './settings-labels.ts';

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

describe('authoring settings labels', () => {
  it('枚举常量都非空', () => {
    expect(SETTING_SECTION_IDS.length).toBeGreaterThan(0);
    expect(CAST_MODES.length).toBeGreaterThan(0);
    expect(HINT_MODES.length).toBeGreaterThan(0);
    expect(OPENING_MODES.length).toBeGreaterThan(0);
  });

  it('每节都有标题、说明和占位文字', () => {
    expectKeys(SETTING_SECTION_IDS.map((id) => SETTING_SECTION_HEADING_KEYS[id]));
    expectKeys(SETTING_SECTION_IDS.map((id) => SETTING_SECTION_HELP_KEYS[id]));
    expectKeys(SETTING_SECTION_IDS.filter((id) => id !== 'opening').map((id) => SETTING_SECTION_PLACEHOLDER_KEYS[id]));
  });

  it('每个主要人物模式都有非空文案', () => {
    expectKeys(CAST_MODES.map((mode) => CAST_MODE_LABEL_KEYS[mode]));
  });

  it('每个提示模式都有非空文案', () => {
    expectKeys(HINT_MODES.map((mode) => HINT_MODE_LABEL_KEYS[mode]));
  });

  it('每个开场模式都有非空文案', () => {
    for (const mode of OPENING_MODES) {
      expect(textOf(OPENING_MODE_LABEL_KEYS[mode]), mode).not.toBe('');
      expect(textOf(OPENING_TEXT_LABEL_KEYS[mode]), mode).not.toBe('');
      expect(textOf(OPENING_PLACEHOLDER_KEYS[mode]), mode).not.toBe('');
    }
  });
});
