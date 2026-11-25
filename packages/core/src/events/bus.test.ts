import { describe, expect, it } from "vitest";
import type { CoreEvent } from "@unwritten/contracts";
import { createEventBus } from "./bus.ts";

const workId = "00000000-0000-4000-8000-000000000001";

function take(iterator: AsyncGenerator<CoreEvent>): CoreEvent[] {
  const events: CoreEvent[] = [];
  void (async () => {
    for await (const event of iterator) events.push(event);
  })();
  return events;
}

describe("createEventBus", () => {
  it("两个订阅者都收到同一事件", async () => {
    const bus = createEventBus();
    const first = new AbortController();
    const second = new AbortController();
    const firstEvents = take(bus.subscribe(first.signal));
    const secondEvents = take(bus.subscribe(second.signal));
    bus.publish({ type: "works.changed", workId });
    await new Promise((resolve) => setImmediate(resolve));
    first.abort();
    second.abort();
    expect(firstEvents).toHaveLength(1);
    expect(secondEvents).toHaveLength(1);
  });

  it("abort 后迭代结束，监听器不再积压", async () => {
    const bus = createEventBus();
    const controller = new AbortController();
    const iterator = bus.subscribe(controller.signal);
    controller.abort();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(() => bus.publish({ type: "works.changed", workId })).not.toThrow();
  });
});
