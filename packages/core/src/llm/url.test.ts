import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "./url.ts";

describe("normalizeBaseUrl", () => {
  it("去掉末尾斜杠和已知路径", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434/v1");
    expect(normalizeBaseUrl("https://x.example/v1/chat/completions")).toBe("https://x.example/v1");
    expect(normalizeBaseUrl("https://x.example/v1#frag")).toBe("https://x.example/v1");
  });

  it("拒绝账号、查询参数和非 http 地址", () => {
    expect(normalizeBaseUrl("https://u:p@x.example/v1")).toBeNull();
    expect(normalizeBaseUrl("https://x.example/v1?a=1")).toBeNull();
    expect(normalizeBaseUrl("ftp://x.example")).toBeNull();
    expect(normalizeBaseUrl("不是地址")).toBeNull();
  });
});
