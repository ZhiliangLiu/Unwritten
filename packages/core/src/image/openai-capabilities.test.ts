import { describe, expect, it } from 'vitest';
import { openAiCapabilities, openAiSizeFor, prefillOpenAiOptions } from './openai-capabilities.ts';

describe('prefillOpenAiOptions', () => {
  it('gpt-image-2 开头用 16 张参考图和自定义尺寸', () => {
    expect(prefillOpenAiOptions('gpt-image-2')).toEqual({ maxReferences: 16, sizes: 'custom' });
    expect(prefillOpenAiOptions('gpt-image-2-2026-preview')).toEqual({ maxReferences: 16, sizes: 'custom' });
  });

  it('固定尺寸模型用 16 张参考图和固定尺寸', () => {
    for (const model of ['gpt-image-1.5', 'gpt-image-1-mini', 'chatgpt-image-latest']) {
      expect(prefillOpenAiOptions(model)).toEqual({ maxReferences: 16, sizes: 'fixed' });
    }
  });

  it('其他模型不调编辑接口', () => {
    for (const model of ['gpt-image-1', 'dall-e-3', '']) {
      expect(prefillOpenAiOptions(model)).toEqual({ maxReferences: 0, sizes: 'fixed' });
    }
  });
});

describe('openAiCapabilities', () => {
  it('两类尺寸都固定为无 seed、无负面提示词和两档质量', () => {
    for (const sizes of ['fixed', 'custom'] as const) {
      expect(openAiCapabilities({ maxReferences: 16, sizes })).toMatchObject({
        maxReferences: 16,
        maxReferenceBytes: null,
        maxPromptLength: null,
        seed: false,
        negativePrompt: false,
        qualities: ['fast', 'best'],
      });
    }
  });

  it('固定尺寸只提供 1K 的三条比例', () => {
    const capabilities = openAiCapabilities({ maxReferences: 16, sizes: 'fixed' });
    expect(capabilities.aspects).toEqual(['1:1', '3:2', '2:3']);
    expect(capabilities.resolutions).toEqual({
      '1:1': { '1k': { width: 1024, height: 1024 } },
      '3:2': { '1k': { width: 1536, height: 1024 } },
      '2:3': { '1k': { width: 1024, height: 1536 } },
    });
  });

  it('自定义尺寸提供七个比例，720 没有方图', () => {
    const capabilities = openAiCapabilities({ maxReferences: 16, sizes: 'custom' });
    expect(capabilities.aspects).toEqual(['1:1', '3:2', '2:3', '3:4', '4:3', '16:9', '9:16']);
    expect(capabilities.resolutions['1:1']).toEqual({
      '1k': { width: 1024, height: 1024 },
      '2k': { width: 2048, height: 2048 },
    });
    expect(capabilities.resolutions['16:9']?.['1k']).toEqual({ width: 1824, height: 1024 });
    expect(capabilities.resolutions['9:16']?.['2k']).toEqual({ width: 2048, height: 3648 });
  });

  it('自定义尺寸的每一项都满足 OpenAI 的限制', () => {
    const capabilities = openAiCapabilities({ maxReferences: 16, sizes: 'custom' });
    const entries = Object.entries(capabilities.resolutions).flatMap(([aspect, tiers]) =>
      Object.entries(tiers).map(([tier, size]) => ({ aspect, tier, ...size })),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const { aspect, tier, width, height } of entries) {
      const label = `${aspect} ${tier} ${width}x${height}`;
      expect(width % 16, label).toBe(0);
      expect(height % 16, label).toBe(0);
      expect(Math.max(width, height), label).toBeLessThanOrEqual(3840);
      expect(Math.max(width, height) / Math.min(width, height), label).toBeLessThanOrEqual(3);
      const pixels = width * height;
      expect(pixels, label).toBeGreaterThanOrEqual(655_360);
      expect(pixels, label).toBeLessThanOrEqual(8_294_400);
    }
  });
});

describe('openAiSizeFor', () => {
  it('自定义尺寸里方图没有 720', () => {
    expect(openAiSizeFor('custom', '1:1', '720')).toBeNull();
    expect(openAiSizeFor('custom', '1:1', '1k')).toEqual({ width: 1024, height: 1024 });
  });

  it('默认档取 1K', () => {
    expect(openAiSizeFor('custom', '3:2', 'default')).toEqual({ width: 1536, height: 1024 });
    expect(openAiSizeFor('fixed', '2:3', 'default')).toEqual({ width: 1024, height: 1536 });
  });

  it('固定尺寸只有 1K', () => {
    expect(openAiSizeFor('fixed', '3:2', '720')).toBeNull();
    expect(openAiSizeFor('fixed', '3:2', '2k')).toBeNull();
    expect(openAiSizeFor('fixed', '3:2', '1k')).toEqual({ width: 1536, height: 1024 });
  });

  it('表里没有的比例返回空', () => {
    expect(openAiSizeFor('fixed', '16:9', '1k')).toBeNull();
    expect(openAiSizeFor('custom', '21:9', '1k')).toBeNull();
  });
});
