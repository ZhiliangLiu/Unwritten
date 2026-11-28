import PQueue from 'p-queue';

export const FAST_IMAGE_PRIORITY = 1;
export const NORMAL_IMAGE_PRIORITY = 0;

export interface ImageQueue {
  run<T>(serviceId: string, priority: number, task: () => Promise<T>): Promise<T>;
  whenIdle(): Promise<void>;
}

export function createImageQueue(): ImageQueue {
  const queues = new Map<string, PQueue>();

  const queueFor = (serviceId: string): PQueue => {
    const existing = queues.get(serviceId);
    if (existing) return existing;
    const queue = new PQueue({ concurrency: 1 });
    queues.set(serviceId, queue);
    return queue;
  };

  return {
    run(serviceId, priority, task) {
      return queueFor(serviceId).add(task, { priority });
    },
    async whenIdle() {
      for (;;) {
        await Promise.all([...queues.values()].map((queue) => queue.onIdle()));
        if ([...queues.values()].every((queue) => queue.size === 0 && queue.pending === 0)) return;
      }
    },
  };
}
