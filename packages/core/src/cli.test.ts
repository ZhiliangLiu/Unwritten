import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cli.ts";

describe("parseCliArgs", () => {
  it("缺少 --data-dir 报错", () => {
    expect(() => parseCliArgs([])).toThrow();
  });

  it("端口超出范围报错", () => {
    expect(() => parseCliArgs(["--data-dir", "/tmp/uw", "--port", "70000"])).toThrow();
    expect(() => parseCliArgs(["--data-dir", "/tmp/uw", "--port", "abc"])).toThrow();
  });

  it("默认值正确", () => {
    const options = parseCliArgs(["--data-dir", "/tmp/uw"]);
    expect(options.port).toBe(0);
    expect(options.clientOrigin).toBeNull();
    expect(options.logLevel).toBe("info");
    expect(options.clientDir.endsWith("apps/client/dist")).toBe(true);
  });

  it("client-origin 去除末尾斜杠", () => {
    expect(parseCliArgs(["--data-dir", "/tmp/uw", "--client-origin", "http://localhost:5173/"]).clientOrigin).toBe(
      "http://localhost:5173",
    );
  });

  it("client-origin 不能带路径", () => {
    expect(() => parseCliArgs(["--data-dir", "/tmp/uw", "--client-origin", "http://localhost:5173/app"])).toThrow();
  });
});
