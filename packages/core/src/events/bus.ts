import type { CoreEvent } from "@unwritten/contracts";

export interface EventBus {
  publish(event: CoreEvent): void;
  subscribe(signal: AbortSignal): AsyncGenerator<CoreEvent>;
}

export function createEventBus(): EventBus {
  const listeners = new Set<(event: CoreEvent) => void>();
  return {
    publish(event) {
      for (const listener of listeners) listener(event);
    },
    async *subscribe(signal) {
      const queue: CoreEvent[] = [];
      let wake: (() => void) | null = null;
      const notify = () => {
        const resolve = wake;
        wake = null;
        resolve?.();
      };
      const listener = (event: CoreEvent) => {
        queue.push(event);
        notify();
      };
      listeners.add(listener);
      signal.addEventListener("abort", notify, { once: true });
      try {
        while (!signal.aborted) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else wake = resolve;
          });
        }
      } finally {
        listeners.delete(listener);
        signal.removeEventListener("abort", notify);
      }
    },
  };
}
