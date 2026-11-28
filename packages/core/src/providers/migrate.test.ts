import { describe, expect, it } from 'vitest';
import { upgradeProvidersObject } from './migrate.ts';

describe('upgradeProvidersObject', () => {
  it('版本 1 补上空出图配置并升到 2', () => {
    const parsed = { version: 1, endpoints: [], purposes: {} };
    const result = upgradeProvidersObject(parsed);
    expect(result.fromVersion).toBe(1);
    expect(result.value).toEqual({
      version: 2,
      endpoints: [],
      purposes: {},
      imageServices: [],
      image: { service: null },
    });
    expect(result.value).not.toBe(parsed);
  });

  it('版本 1 已有的出图配置原样保留', () => {
    const parsed = {
      version: 1,
      imageServices: [{ id: 'image-openai-9b1c2d' }],
      image: { service: 'image-openai-9b1c2d' },
    };
    expect(upgradeProvidersObject(parsed).value).toEqual({
      version: 2,
      imageServices: parsed.imageServices,
      image: parsed.image,
    });
  });

  it('版本 2 原样返回', () => {
    const parsed = { version: 2 };
    expect(upgradeProvidersObject(parsed)).toEqual({ value: parsed, fromVersion: 2 });
  });

  it('其他情况原样返回并报告 null', () => {
    expect(upgradeProvidersObject({ version: 3 })).toEqual({ value: { version: 3 }, fromVersion: null });
    expect(upgradeProvidersObject('nope')).toEqual({ value: 'nope', fromVersion: null });
    expect(upgradeProvidersObject(null)).toEqual({ value: null, fromVersion: null });
  });

  it('不修改传入对象', () => {
    const parsed = { version: 1, endpoints: [] };
    const copy = structuredClone(parsed);
    upgradeProvidersObject(parsed);
    expect(parsed).toEqual(copy);
  });
});
