import { describe, expect, it } from 'vitest';
import { createRendererRecovery, RENDERER_RELOAD_WINDOW_MS } from './renderer-recovery.ts';

describe('createRendererRecovery', () => {
  it('第一次崩溃直接重开', () => {
    const recovery = createRendererRecovery(() => 0);
    expect(recovery.next()).toBe('reload');
  });

  it('重开后很快又崩溃时改为询问', () => {
    let clock = 0;
    const recovery = createRendererRecovery(() => clock);
    recovery.reloaded();
    clock = RENDERER_RELOAD_WINDOW_MS - 1;
    expect(recovery.next()).toBe('ask');
  });

  it('隔了足够久的崩溃仍然直接重开', () => {
    let clock = 0;
    const recovery = createRendererRecovery(() => clock);
    recovery.reloaded();
    clock = RENDERER_RELOAD_WINDOW_MS;
    expect(recovery.next()).toBe('reload');
  });
});
