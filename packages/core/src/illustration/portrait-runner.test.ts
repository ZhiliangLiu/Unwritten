import { describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { createPortraitRunner } from './portrait-runner.ts';

describe('portrait runner', () => {
  it('whenIdle 等到所有已登记的任务结束', async () => {
    const runner = createPortraitRunner();
    const finished: string[] = [];
    runner.run(async () => {
      await delay(10);
      finished.push('first');
    });
    runner.run(async () => {
      await delay(20);
      finished.push('second');
    });
    expect(finished).toEqual([]);
    await runner.whenIdle();
    expect(finished).toEqual(['first', 'second']);
  });

  it('任务失败不会留下未处理的拒绝，集合照样清空', async () => {
    const runner = createPortraitRunner();
    runner.run(async () => {
      throw new Error('failed portrait');
    });
    await runner.whenIdle();
    await runner.whenIdle();
    expect(true).toBe(true);
  });
});
