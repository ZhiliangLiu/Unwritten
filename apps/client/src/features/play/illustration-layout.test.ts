import { describe, expect, it } from 'vitest';
import type { IllustrationView, TurnView } from '@unwritten/contracts';
import { frameAspect, placementOf } from './illustration-layout.ts';

function illustration(overrides: Partial<IllustrationView> = {}): IllustrationView {
  return {
    id: crypto.randomUUID(),
    updatedAt: 1,
    status: 'queued',
    rerolling: false,
    para: 0,
    format: null,
    image: null,
    caption: null,
    error: null,
    stage: null,
    serviceId: null,
    ...overrides,
  };
}

function turn(overrides: Partial<TurnView> = {}): TurnView {
  return {
    id: crypto.randomUUID(),
    originRequest: null,
    depth: 1,
    action: null,
    paragraphs: ['第一段', '第二段', '第三段'],
    options: [],
    illustration: null,
    createdAt: 1,
    ...overrides,
  };
}

describe('frameAspect', () => {
  it('有完成图时用图片宽高', () => {
    const view = illustration({ image: { width: 1200, height: 800 } });
    expect(frameAspect(view)).toBe(1.5);
  });

  it('没有完成图时用已确定的像素尺寸', () => {
    const view = illustration({
      format: { aspectPreference: '3:2', resolutionTier: '1k', size: { width: 900, height: 1200 } },
    });
    expect(frameAspect(view)).toBe(0.75);
  });

  it('没有像素尺寸时用比例', () => {
    const view = illustration({ format: { aspectPreference: '3:2', resolutionTier: '1k', size: null } });
    expect(frameAspect(view)).toBe(1.5);
  });

  it('自动比例尚未确定时返回 null', () => {
    expect(frameAspect(illustration())).toBeNull();
    expect(
      frameAspect(illustration({ format: { aspectPreference: 'auto', resolutionTier: '1k', size: null } })),
    ).toBeNull();
  });
});

describe('placementOf', () => {
  it('段号 0 放在第一段之前', () => {
    expect(placementOf(turn({ illustration: illustration({ para: 0 }) }))).toBe(0);
  });

  it('段号 n 放在第 n 段之后', () => {
    expect(placementOf(turn({ illustration: illustration({ para: 2 }) }))).toBe(2);
  });

  it('没有插图时按第一段之前处理', () => {
    expect(placementOf(turn())).toBe(0);
  });
});
