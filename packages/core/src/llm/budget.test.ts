import { describe, expect, it } from "vitest";
import { defaultMaxTokens, estimateTokens } from "./budget.ts";

describe("budget", () => {
  it("按中日韩字符和其他字符估算", () => {
    expect(estimateTokens("你好")).toBe(4);
    expect(estimateTokens("abcdef")).toBe(2);
  });

  it("默认输出上限在 256 到 16384 之间", () => {
    expect(defaultMaxTokens(32768)).toBe(8192);
    expect(defaultMaxTokens(512)).toBe(256);
    expect(defaultMaxTokens(1_000_000)).toBe(16384);
  });
});
