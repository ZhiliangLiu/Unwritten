interface RunningTask {
  promise: Promise<void>;
}

export interface PortraitRunner {
  run(task: () => Promise<void>): void;
  whenIdle(): Promise<void>;
}

export function createPortraitRunner(): PortraitRunner {
  const running = new Set<RunningTask>();

  return {
    run(task) {
      const entry: RunningTask = { promise: Promise.resolve() };
      entry.promise = (async () => {
        try {
          await task();
        } finally {
          running.delete(entry);
        }
      })();
      running.add(entry);
      void entry.promise.catch(() => {});
    },
    async whenIdle() {
      while (running.size > 0) await Promise.allSettled([...running].map((entry) => entry.promise));
    },
  };
}
