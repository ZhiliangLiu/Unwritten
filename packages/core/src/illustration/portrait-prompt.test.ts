import { describe, expect, it } from 'vitest';
import { frontPrompt, previewPrompt, viewPrompt } from './portrait-prompt.ts';

const PAINTERLY = { kind: 'preset', preset: 'painterly' } as const;

describe('portrait prompts', () => {
  it('正面用固定构图和形象原文，末尾附预设画风片段', () => {
    const prompt = frontPrompt('短卷发，左眉有一道浅缺口，穿深色短外套', PAINTERLY);
    expect(prompt).toContain(
      'Eye-level, straight-on head-and-shoulders portrait of one person. Show the face, hairline and distinctive asymmetries.',
    );
    expect(prompt).toContain('Relaxed expression, simple clothing, plain background.');
    expect(prompt).toContain('Visible appearance: 短卷发，左眉有一道浅缺口，穿深色短外套');
    expect(
      prompt.endsWith(
        'painterly illustration, textured brushstrokes, layered color, soft edges and deliberate focal detail',
      ),
    ).toBe(true);
  });

  it('自定义画风只附画风原文', () => {
    const prompt = frontPrompt('灰白短发', { kind: 'custom', text: '旧照片的颗粒感' });
    expect(prompt).toContain('style: 旧照片的颗粒感');
    expect(prompt).not.toContain('painterly illustration');
  });

  it('斜侧脸和全身都以 {{ref:1}} 指代正面，并写明各自的构图', () => {
    const threeQuarter = viewPrompt('three_quarter', PAINTERLY);
    expect(threeQuarter).toContain('The same person as {{ref:1}}, head and shoulders at a three-quarter angle.');
    expect(threeQuarter).toContain('Make the nose bridge, jawline and side contour clear.');

    const fullBody = viewPrompt('full_body', PAINTERLY);
    expect(fullBody).toContain(
      'The same person as {{ref:1}}, standing naturally with the whole figure visible from head to feet.',
    );
    expect(fullBody).toContain('Show the build and proportions clearly.');
  });

  it('画风预览用固定题材，没有参考图也没有人物', () => {
    const prompt = previewPrompt({ kind: 'preset', preset: 'watercolor' });
    expect(prompt).toContain(
      'A small paper lantern and a single white flower on a wooden windowsill, soft afternoon light, a quiet still life, no people, no lettering.',
    );
    expect(prompt).toContain('watercolor illustration, transparent washes, soft pigment edges, paper grain');
    expect(prompt).not.toContain('{{ref:');
  });
});
