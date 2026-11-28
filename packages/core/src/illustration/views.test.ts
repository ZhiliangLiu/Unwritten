import { describe, expect, it } from 'vitest';
import type { AttemptData, ImageFileRef } from '../store/illustration-types.ts';
import type { IllustrationRow } from './views.ts';
import { illustrationView } from './views.ts';

const file: ImageFileRef = { hash: 'a'.repeat(64), mime: 'image/png', width: 1536, height: 1024, bytes: 2048 };

function attempt(overrides: Partial<AttemptData> = {}): AttemptData {
  return {
    attemptId: '00000000-0000-4000-8000-000000000001',
    kind: 'reroll',
    formatOverride: null,
    format: null,
    shot: null,
    referenceFiles: null,
    seed: null,
    serviceId: 'image-old',
    completed: [],
    ...overrides,
  };
}

function row(overrides: Partial<IllustrationRow> = {}): IllustrationRow {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    turnId: '00000000-0000-4000-8000-000000000003',
    playthroughId: '00000000-0000-4000-8000-000000000004',
    para: 2,
    formatPreference: { aspectPreference: 'auto', resolutionTier: '1k' },
    format: null,
    status: 'queued',
    stage: null,
    caption: null,
    prompt: null,
    negativePrompt: null,
    shotCapability: null,
    refs: null,
    referenceFiles: null,
    seed: null,
    serviceId: null,
    model: null,
    file: null,
    error: null,
    attempts: 0,
    activeAttemptId: null,
    attemptData: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('illustrationView', () => {
  it('已完成的图使用落库的规格、服务和宽高，有待处理重画时标记 rerolling', () => {
    const view = illustrationView(
      row({
        status: 'done',
        file,
        format: { aspectPreference: '3:2', resolutionTier: '1k', size: { width: 1536, height: 1024 } },
        caption: '灯下的对话。',
        serviceId: 'image-done',
        activeAttemptId: '00000000-0000-4000-8000-000000000009',
        attemptData: attempt({ format: { aspectPreference: '2:3', resolutionTier: '1k', size: null } }),
      }),
    );
    expect(view).toEqual({
      id: '00000000-0000-4000-8000-000000000002',
      updatedAt: 2,
      status: 'done',
      rerolling: true,
      para: 2,
      format: { aspectPreference: '3:2', resolutionTier: '1k', size: { width: 1536, height: 1024 } },
      image: { width: 1536, height: 1024 },
      caption: '灯下的对话。',
      error: null,
      stage: null,
      serviceId: 'image-done',
    });
  });

  it('没有完成图时取本次尝试的规格和服务，失败记录带错误与阶段', () => {
    const view = illustrationView(
      row({
        status: 'failed',
        stage: 'generate',
        error: 'image_offline',
        attemptData: attempt({
          format: { aspectPreference: '3:4', resolutionTier: '720', size: { width: 720, height: 960 } },
        }),
      }),
    );
    expect(view.status).toBe('failed');
    expect(view.format).toEqual({
      aspectPreference: '3:4',
      resolutionTier: '720',
      size: { width: 720, height: 960 },
    });
    expect(view.serviceId).toBe('image-old');
    expect(view.error).toBe('image_offline');
    expect(view.stage).toBe('generate');
    expect(view.image).toBeNull();
    expect(view.rerolling).toBe(false);
  });

  it('还在队列里且比例固定时给出规格、宽高留空；自动比例时为 null', () => {
    const fixed = illustrationView(row({ formatPreference: { aspectPreference: '3:2', resolutionTier: '2k' } }));
    expect(fixed.format).toEqual({ aspectPreference: '3:2', resolutionTier: '2k', size: null });
    const auto = illustrationView(row());
    expect(auto.format).toBeNull();
  });
});
