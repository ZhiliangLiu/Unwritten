import {
  ILLUSTRATION_STAGES,
  IMAGE_SERVICE_STATES,
  IMAGE_TIER_PREFERENCES,
  LAUNCHER_FAILURE_REASONS,
  PORTRAIT_SLOTS,
  STYLE_PRESETS,
} from '@unwritten/contracts';
import { describe, expect, it } from 'vitest';
import play from '../../i18n/zh-CN/play.json';
import {
  ILLUSTRATION_STAGE_LABEL_KEYS,
  IMAGE_TIER_LABEL_KEYS,
  PORTRAIT_SLOT_LABEL_KEYS,
  SERVICE_STATE_LABEL_KEYS,
  STYLE_PRESET_LABEL_KEYS,
  WAKE_REASON_LABEL_KEYS,
} from './image-labels.ts';

function textOf(key: string): string {
  const path = key.replace(/^play:/, '').split('.');
  let value: unknown = play;
  for (const part of path) {
    if (!value || typeof value !== 'object') return '';
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : '';
}

function expectLabels(values: readonly string[], labels: Record<string, string>): void {
  expect(values.length).toBeGreaterThan(0);
  for (const value of values) {
    const key = labels[value];
    expect(key, value).toBeTruthy();
    if (key) expect(textOf(key), key).not.toBe('');
  }
}

describe('image labels', () => {
  it('每个画风预设都有非空文案', () => {
    expectLabels(STYLE_PRESETS, STYLE_PRESET_LABEL_KEYS);
  });

  it('每个分辨率档位都有非空文案', () => {
    expectLabels(IMAGE_TIER_PREFERENCES, IMAGE_TIER_LABEL_KEYS);
  });

  it('每个人物参考位置都有非空文案', () => {
    expectLabels(PORTRAIT_SLOTS, PORTRAIT_SLOT_LABEL_KEYS);
  });

  it('每个服务状态都有非空文案', () => {
    expectLabels(IMAGE_SERVICE_STATES, SERVICE_STATE_LABEL_KEYS);
  });

  it('每个唤醒失败原因都有非空文案', () => {
    expectLabels(LAUNCHER_FAILURE_REASONS, WAKE_REASON_LABEL_KEYS);
  });

  it('每个插图阶段都有非空文案', () => {
    expectLabels(ILLUSTRATION_STAGES, ILLUSTRATION_STAGE_LABEL_KEYS);
  });
});
