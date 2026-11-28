import { describe, expect, it } from 'vitest';
import { prefillOpenAiOptions } from './openai-prefill.ts';

describe('prefillOpenAiOptions', () => {
  const openaiDefaults = {
    outputFormat: 'webp',
    responseFormat: 'omit',
    referenceTransport: 'edits',
    disableWatermark: false,
  } as const;

  it('gpt-image-2 开头用 16 张参考图和自定义尺寸', () => {
    expect(prefillOpenAiOptions('gpt-image-2')).toEqual({ maxReferences: 16, sizes: 'custom', ...openaiDefaults });
    expect(prefillOpenAiOptions('gpt-image-2-2026-preview')).toEqual({
      maxReferences: 16,
      sizes: 'custom',
      ...openaiDefaults,
    });
  });

  it('固定尺寸模型用 16 张参考图和固定尺寸', () => {
    for (const model of ['gpt-image-1.5', 'gpt-image-1-mini', 'chatgpt-image-latest']) {
      expect(prefillOpenAiOptions(model)).toEqual({ maxReferences: 16, sizes: 'fixed', ...openaiDefaults });
    }
  });

  it('其他模型不预填参考图', () => {
    for (const model of ['gpt-image-1', 'dall-e-3', '']) {
      expect(prefillOpenAiOptions(model)).toEqual({ maxReferences: 0, sizes: 'fixed', ...openaiDefaults });
    }
  });
});
