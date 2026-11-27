export const RENDERER_RELOAD_WINDOW_MS = 10_000;

export type RendererRecovery = 'reload' | 'ask';

export function createRendererRecovery(now: () => number): {
  next(): RendererRecovery;
  reloaded(): void;
} {
  let lastReloadAt: number | null = null;
  return {
    next() {
      if (lastReloadAt !== null && now() - lastReloadAt < RENDERER_RELOAD_WINDOW_MS) return 'ask';
      return 'reload';
    },
    reloaded() {
      lastReloadAt = now();
    },
  };
}
