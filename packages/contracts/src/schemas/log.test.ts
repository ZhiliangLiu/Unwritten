import { describe, expect, it } from "vitest";
import { ClientLogInputSchema } from "./log.ts";

const workId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";

describe("ClientLogInputSchema", () => {
  it("接受结构化错误", () => {
    expect(ClientLogInputSchema.safeParse({ kind: "event", area: "play", code: "stale_head" }).success).toBe(true);
  });

  it("拒绝额外字段", () => {
    expect(
      ClientLogInputSchema.safeParse({ kind: "event", area: "play", code: "stale_head", detail: "oops" }).success,
    ).toBe(false);
  });

  it("接受带 jobId 的预览样本", () => {
    expect(
      ClientLogInputSchema.safeParse({
        kind: "sample",
        metric: "client.preview_visible",
        durationMs: 12.5,
        outcome: "ok",
        jobId,
      }).success,
    ).toBe(true);
  });

  it("接受带请求和尝试号的续写样本", () => {
    expect(
      ClientLogInputSchema.safeParse({
        kind: "sample",
        metric: "client.turn_visible",
        durationMs: 10,
        outcome: "error",
        requestId,
        workId,
        attempt: 2,
      }).success,
    ).toBe(true);
  });

  it("拒绝负数、NaN、未知指标、未知关联 ID 和无效尝试号", () => {
    const base = { kind: "sample", metric: "client.library_ready", outcome: "ok" } as const;
    expect(ClientLogInputSchema.safeParse({ ...base, durationMs: -1 }).success).toBe(false);
    expect(ClientLogInputSchema.safeParse({ ...base, durationMs: Number.NaN }).success).toBe(false);
    expect(ClientLogInputSchema.safeParse({ ...base, metric: "client.unknown", durationMs: 1 }).success).toBe(false);
    expect(ClientLogInputSchema.safeParse({ ...base, durationMs: 1, jobId: "not-a-uuid" }).success).toBe(false);
    expect(
      ClientLogInputSchema.safeParse({
        kind: "sample",
        metric: "client.turn_visible",
        durationMs: 1,
        outcome: "ok",
        requestId,
        attempt: 0,
      }).success,
    ).toBe(false);
  });
});
