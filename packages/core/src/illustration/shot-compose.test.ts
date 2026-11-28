import { describe, expect, it } from 'vitest';
import { composeFinalPrompt, dropReference } from './shot-compose.ts';
import type { ShotResult } from './shot.ts';

const shot: ShotResult = {
  prompt: 'A short-haired figure holds out a brass key.',
  negative: 'blurry edges',
  caption: '修表匠把钥匙递到半空。',
  refs: [
    { code: 'C1', view: 'front' },
    { code: 'C2', view: 'full_body' },
  ],
  aspect: '3:2',
  corrections: 0,
};

const style = { kind: 'preset', preset: 'watercolor' } as const;

describe('composeFinalPrompt', () => {
  it('服务没有负面提示词时把避开文字写成正面要求，负面为 null', () => {
    const result = composeFinalPrompt({ shot, style, protagonistInFrame: true, negativePrompt: false });
    expect(result.prompt).toBe(
      'watercolor illustration, transparent washes, soft pigment edges, paper grain, A short-haired figure holds out a brass key., keep the picture free of lettering, subtitles, labels, logos and watermarks',
    );
    expect(result.negativePrompt).toBeNull();
  });

  it('支持负面提示词时固定避开词进入负面，正面没有那一句', () => {
    const result = composeFinalPrompt({ shot, style, protagonistInFrame: true, negativePrompt: true });
    expect(result.negativePrompt).toBe('blurry edges, text, lettering, subtitles, labels, logos, watermarks');
    expect(result.prompt).not.toContain('keep the picture free of lettering');
  });

  it('主角不入画时加上第一人称视角的固定句', () => {
    const result = composeFinalPrompt({ shot, style, protagonistInFrame: false, negativePrompt: true });
    expect(result.prompt).toBe(
      'watercolor illustration, transparent washes, soft pigment edges, paper grain, A short-haired figure holds out a brass key., first-person viewpoint, the viewpoint character is outside the frame',
    );
  });

  it('自定义画风不拼预设片段', () => {
    const result = composeFinalPrompt({
      shot,
      style: { kind: 'custom', text: '水彩，暖色' },
      protagonistInFrame: true,
      negativePrompt: false,
    });
    expect(result.prompt).toBe(
      'A short-haired figure holds out a brass key., keep the picture free of lettering, subtitles, labels, logos and watermarks',
    );
  });
});

describe('dropReference', () => {
  it('把被换掉的引用写成文字，后面的序号依次减一，refs 少一项', () => {
    const result = dropReference('{{ref:1}} hands a brass key to {{ref:2}}.', shot.refs, 0, '一个高个子男人');
    expect(result.prompt).toBe('一个高个子男人 hands a brass key to {{ref:1}}.');
    expect(result.refs).toEqual([{ code: 'C2', view: 'full_body' }]);
  });
});
