import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ILLUSTRATION_SETTINGS,
  EMPTY_PORTRAIT_SLOTS,
  EMPTY_PORTRAIT_TASKS,
  IllustrationSettingsSchema,
  ImageFileRefSchema,
  PlaythroughIllustrationSchema,
  PortraitSlotsStoredSchema,
  PortraitTasksSchema,
  TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION,
} from './illustration-types.ts';

const schemaSource = readFileSync(fileURLToPath(new URL('./schema.ts', import.meta.url)), 'utf8');

function schemaDefaults(): Record<string, unknown>[] {
  return [...schemaSource.matchAll(/\.default\(\s*sql`'(\{[^']*\})'`\s*,?\s*\)/gu)].map(
    (match) => JSON.parse(match[1] ?? '') as Record<string, unknown>,
  );
}

describe('illustration types', () => {
  it('迁移默认值和空状态都通过各自的 schema', () => {
    expect(PlaythroughIllustrationSchema.parse(TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION)).toEqual(
      TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION,
    );
    expect(IllustrationSettingsSchema.parse(DEFAULT_ILLUSTRATION_SETTINGS)).toEqual(DEFAULT_ILLUSTRATION_SETTINGS);
    expect(PortraitSlotsStoredSchema.parse(EMPTY_PORTRAIT_SLOTS)).toEqual(EMPTY_PORTRAIT_SLOTS);
    expect(PortraitTasksSchema.parse(EMPTY_PORTRAIT_TASKS)).toEqual(EMPTY_PORTRAIT_TASKS);
  });

  it('schema.ts 的迁移默认值和常量一致', () => {
    const defaults = schemaDefaults();
    expect(defaults).toHaveLength(2);
    const playthrough = defaults.find((value) => 'enabled' in value);
    const settings = defaults.find((value) => 'autoEnabled' in value);
    expect(playthrough).toEqual(TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION);
    expect(settings).toEqual(DEFAULT_ILLUSTRATION_SETTINGS);
  });

  it('文件引用只接受小写十六进制的 64 位哈希', () => {
    const valid = {
      hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
      mime: 'image/png' as const,
      width: 1024,
      height: 1024,
      bytes: 2048,
    };
    expect(ImageFileRefSchema.parse(valid)).toEqual(valid);
    expect(ImageFileRefSchema.safeParse({ ...valid, hash: valid.hash.toUpperCase() }).success).toBe(false);
    expect(ImageFileRefSchema.safeParse({ ...valid, hash: valid.hash.slice(0, 63) }).success).toBe(false);
  });
});
