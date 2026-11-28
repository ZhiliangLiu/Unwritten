import { describe, expect, it } from 'vitest';
import type { ImageFileRef } from '../store/illustration-types.ts';
import type { portraitSets } from '../store/schema.ts';
import { toView } from './portrait-views.ts';

function file(hash: string): ImageFileRef {
  return { hash, mime: 'image/png', width: 640, height: 960, bytes: 128 };
}

function row(overrides: Partial<typeof portraitSets.$inferSelect> = {}): typeof portraitSets.$inferSelect {
  return {
    id: 'set-1',
    workId: 'work-1',
    scope: 'work',
    playthroughId: null,
    entityId: 'entity-1',
    appearanceFactId: null,
    appearanceHash: 'a'.repeat(64),
    appearance: '灰白短发',
    style: { kind: 'preset', preset: 'painterly' },
    state: 'draft',
    draftRev: 3,
    slots: {
      front: { file: file('b'.repeat(64)), source: 'import', needsReview: false },
      three_quarter: { file: null, source: null, needsReview: false },
      full_body: { file: file('c'.repeat(64)), source: 'generate', needsReview: true },
    },
    task: {
      front: null,
      three_quarter: {
        attemptId: '11111111-1111-4111-8111-111111111111',
        status: 'running',
        error: null,
        format: null,
        quality: 'best',
        inputFiles: [],
        appearanceHash: 'a'.repeat(64),
      },
      full_body: {
        attemptId: '22222222-2222-4222-8222-222222222222',
        status: 'failed',
        error: 'image_out_of_memory',
        format: null,
        quality: 'best',
        inputFiles: [],
        appearanceHash: 'a'.repeat(64),
      },
    },
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('portrait view', () => {
  it('按正面、斜侧脸、全身的顺序给出位置、任务和复核状态', () => {
    const view = toView(row());
    expect(view.slots.map((slot) => slot.slot)).toEqual(['front', 'three_quarter', 'full_body']);
    expect(view.slots[0]).toEqual({
      slot: 'front',
      image: { width: 640, height: 960 },
      source: 'import',
      needsReview: false,
      task: null,
    });
    expect(view.slots[1]?.task).toEqual({ status: 'running', error: null });
    expect(view.slots[2]).toEqual({
      slot: 'full_body',
      image: { width: 640, height: 960 },
      source: 'generate',
      needsReview: true,
      task: { status: 'failed', error: 'image_out_of_memory' },
    });
    expect(view).toMatchObject({ id: 'set-1', draftRev: 3, state: 'draft', appearance: '灰白短发' });
  });

  it('没有任务时每个位置都是 null，缺图的位置没有尺寸', () => {
    const view = toView(
      row({
        slots: {
          front: { file: null, source: null, needsReview: false },
          three_quarter: { file: null, source: null, needsReview: false },
          full_body: { file: null, source: null, needsReview: false },
        },
        task: null,
      }),
    );
    expect(view.slots.some((slot) => slot.task !== null)).toBe(false);
    expect(view.slots.some((slot) => slot.image !== null)).toBe(false);
  });
});
