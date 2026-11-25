import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Logger } from "../log/logger.ts";
import { makeTempDataDir } from "../test-support/temp-dir.ts";
import { openDatabase } from "../store/db.ts";
import { startFakeOpenAiServer } from "../test-support/fake-openai-server.ts";
import { rawToolStep } from "../test-support/llm-steps.ts";
import { createRunner, opencodeHeaders } from "./run.ts";
import type { LlmTool } from "./types.ts";

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

const tool: LlmTool = {
  name: "propose_turn",
  description: "提交回合",
  parameters: {},
  async execute() {
    return { text: "已收到", terminate: true };
  },
};

function input() {
  return {
    purpose: "narrator" as const,
    system: "system",
    prompt: "prompt",
    tools: [tool],
    requiredToolName: "propose_turn",
    sessionId: "00000000-0000-4000-8000-000000000001",
    ref: { kind: "job" as const, id: "job", attempt: 1, workId: null },
  };
}

function setup(baseUrl: string, timeouts = { firstOutputMs: 2_000, stallMs: 2_000 }) {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, "library.db"));
  const runner = createRunner({
    db: opened.db,
    logger,
    shutdown: new AbortController().signal,
    timeouts,
    targetFor: () => ({
      endpointId: "test",
      endpointName: "Test",
      baseUrl,
      modelId: "m",
      apiKey: undefined,
      contextWindow: 32_768,
      maxOutputTokens: 1_024,
    }),
  });
  return { temp, opened, runner };
}

describe("createRunner", () => {
  it("工具调用一次成功，并写调用记录", async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue(rawToolStep("propose_turn", { prose: "雨声" }));
      await expect(runner(input())).resolves.toEqual({ requiredToolTerminated: true });
      const rows = opened.db.all<{ status: string }>(sql`select status from llm_calls`);
      expect(rows).toEqual([{ status: "ok" }]);
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]?.headers["user-agent"]).toMatch(/^unwritten\//);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it("先回文本、再调工具时补发提醒", async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue({ kind: "text", text: "我再想想" }, rawToolStep("propose_turn", { prose: "雨声" }));
      await runner(input());
      expect(server.requests).toHaveLength(2);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it("连续三次文本按 invalid_output 失败", async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue({ kind: "text", text: "一" }, { kind: "text", text: "二" }, { kind: "text", text: "三" });
      await expect(runner(input())).rejects.toMatchObject({ code: "invalid_output" });
      expect(server.requests).toHaveLength(3);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it("第一次 500、第二次成功时重试一次", async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue(
        { kind: "http_error", status: 500, message: "boom" },
        rawToolStep("propose_turn", { prose: "雨声" }),
      );
      await runner(input());
      expect(server.requests).toHaveLength(2);
      const rows = opened.db.all<{ status: string }>(sql`select status from llm_calls order by created_at`);
      expect(rows).toEqual([{ status: "error" }, { status: "ok" }]);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it("401 只请求一次", async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue({ kind: "http_error", status: 401, message: "no" });
      await expect(runner(input())).rejects.toMatchObject({ code: "unauthorized" });
      expect(server.requests).toHaveLength(1);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it("输出中途断开按 network 失败且不重试", async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl);
    try {
      server.enqueue({ kind: "drop_mid_stream" });
      await expect(runner(input())).rejects.toMatchObject({ code: "network" });
      expect(server.requests).toHaveLength(1);
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it("没有输出时按 timeout 失败", async () => {
    const server = await startFakeOpenAiServer();
    const { temp, opened, runner } = setup(server.baseUrl, { firstOutputMs: 100, stallMs: 100 });
    try {
      server.enqueue({ kind: "hang" }, { kind: "hang" });
      await expect(runner(input())).rejects.toMatchObject({ code: "timeout" });
    } finally {
      await server.close();
      opened.close();
      temp.cleanup();
    }
  });

  it("只给 opencode.ai 加会话头", () => {
    expect(opencodeHeaders("https://opencode.ai/inference/go/openai/v1", "session")).toEqual({
      "x-opencode-client": "unwritten",
      "x-opencode-session": "session",
    });
    expect(opencodeHeaders("https://example.com/v1", "session")).toEqual({});
  });
});
