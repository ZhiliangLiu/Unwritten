import { describe, expect, it } from "vitest";
import { startFakeOpenAiServer, type FakeStep } from "./fake-openai-server.ts";

const apiKey = "test-key";

async function post(baseUrl: string, body: unknown, key = apiKey) {
  return fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function parseSse(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .map((block) => block.replace(/^data: /, "").trim())
    .filter((block) => block && block !== "[DONE]")
    .map((block) => JSON.parse(block) as Record<string, unknown>);
}

describe("startFakeOpenAiServer", () => {
  it("流式返回工具调用，拼回的参数等于原文", async () => {
    const server = await startFakeOpenAiServer({ apiKey });
    try {
      const args = JSON.stringify({ prose: "雨声盖住钟声。", options: "第一项" });
      server.enqueue({ kind: "tool_call", name: "propose_turn", arguments: args });
      const response = await post(server.baseUrl, { model: "fake", stream: true, messages: [] });
      const chunks = parseSse(await response.text());
      const joined = chunks
        .flatMap(
          (chunk) =>
            (chunk.choices as Array<{ delta?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>) ?? [],
        )
        .map((choice) => choice.delta?.tool_calls?.[0]?.function?.arguments ?? "")
        .join("");
      expect(joined).toBe(args);
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${apiKey}`);
    } finally {
      await server.close();
    }
  });

  it("错误的 key 返回 401", async () => {
    const server = await startFakeOpenAiServer({ apiKey });
    try {
      const response = await post(server.baseUrl, { model: "fake", messages: [] }, "wrong");
      expect(response.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("redirect 不跟随", async () => {
    const server = await startFakeOpenAiServer({ apiKey });
    try {
      server.enqueue({ kind: "redirect", status: 302, location: "http://example.invalid/" });
      const response = await fetch(`${server.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: "fake", messages: [] }),
        redirect: "manual",
      });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("http://example.invalid/");
    } finally {
      await server.close();
    }
  });

  it("队列为空返回 500", async () => {
    const server = await startFakeOpenAiServer({ apiKey });
    try {
      const response = await post(server.baseUrl, { model: "fake", messages: [] });
      expect(response.status).toBe(500);
      expect(await response.text()).toContain("no scripted response");
    } finally {
      await server.close();
    }
  });

  it("drop_mid_stream 让读取正文失败", async () => {
    const server = await startFakeOpenAiServer({ apiKey });
    try {
      server.enqueue({ kind: "drop_mid_stream" });
      await expect(post(server.baseUrl, { model: "fake", stream: true, messages: [] })).rejects.toThrow();
    } finally {
      await server.close();
    }
  });

  it("记录请求体，reset 清空脚本和记录", async () => {
    const server = await startFakeOpenAiServer({ apiKey });
    try {
      const step: FakeStep = { kind: "text", text: "好的" };
      server.enqueue(step);
      await post(server.baseUrl, { model: "fake", messages: [{ role: "user", content: "你好" }] });
      expect(server.pending()).toBe(0);
      expect(server.requests[0]?.body).toMatchObject({ model: "fake" });
      server.enqueue(step);
      server.reset();
      expect(server.pending()).toBe(0);
      expect(server.requests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
