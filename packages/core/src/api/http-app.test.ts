import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../log/logger.ts";
import { createEventBus } from "../events/bus.ts";
import type { Services } from "../services.ts";
import { appError } from "../errors.ts";
import { makeTempDataDir } from "../test-support/temp-dir.ts";
import { createHttpApp } from "./http-app.ts";
import { loadClientAssets } from "./client-assets.ts";

const token = "test-token";

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

function fakeServices(overrides: Partial<Services> = {}): Services {
  const bus = createEventBus();
  return {
    bus,
    logger,
    library: {
      list: () => [],
      create: () => {
        throw new Error("not used");
      },
      get: () => {
        throw new Error("not used");
      },
      saveBackground: () => {
        throw new Error("not used");
      },
    },
    llm: {
      listProviders: () => ({
        status: "missing",
        revision: "absent",
        problem: null,
        endpoints: [],
        defaultModel: null,
        defaultModelUsable: false,
      }),
      createEndpoint: async () => {
        throw new Error("not used");
      },
      updateEndpoint: async () => {
        throw new Error("not used");
      },
      setPurpose: async () => {
        throw new Error("not used");
      },
      testConnection: async () => ({ ok: false, code: null, detail: null, savedToolsCapability: false }),
      resolve: () => null,
      estimateTokens: () => 0,
      run: async () => ({ requiredToolTerminated: true }),
      pruneCalls: () => 0,
    },
    authoring: {
      generatePreview: () => {
        throw new Error("not used");
      },
      adoptPreview: () => {
        throw new Error("not used");
      },
      recoverInterrupted: () => 0,
      whenIdle: async () => {},
    },
    play: {
      getRoute: () => {
        throw new Error("not used");
      },
      submitAction: () => {
        throw new Error("not used");
      },
      retry: () => {
        throw new Error("not used");
      },
      recoverInterrupted: () => 0,
      pruneOldRequestLogs: () => 0,
      whenIdle: async () => {},
    },
    ...overrides,
  };
}

function assets() {
  const temp = makeTempDataDir();
  writeFileSync(join(temp.dir, "index.html"), '<!doctype html><html lang="zh-CN"><head></head><body></body></html>');
  writeFileSync(join(temp.dir, "boot.inline.js"), "console.log(1)");
  mkdirSync(join(temp.dir, "assets"));
  writeFileSync(join(temp.dir, "assets", "app.js"), "console.log(2)");
  return temp;
}

function headers(extra: Record<string, string> = {}) {
  return { host: "127.0.0.1:4317", authorization: `Bearer ${token}`, ...extra };
}

describe("createHttpApp", () => {
  it("校验令牌、Host 和 Origin", async () => {
    const temp = assets();
    try {
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services: fakeServices(),
        logger,
      });
      expect(
        (
          await app.request("http://127.0.0.1:4317/api/works/list", {
            method: "POST",
            body: "{}",
            headers: { host: "127.0.0.1:4317" },
          })
        ).status,
      ).toBe(401);
      expect(
        (await app.request("http://127.0.0.1:4317/api/works/list", { method: "POST", body: "{}", headers: headers() }))
          .status,
      ).toBe(200);
      expect(
        (
          await app.request("http://127.0.0.1:4317/api/works/list", {
            method: "POST",
            body: "{}",
            headers: headers({ host: "evil.example:1" }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request("http://127.0.0.1:4317/api/works/list", {
            method: "POST",
            body: "{}",
            headers: headers({ origin: "http://evil.example" }),
          })
        ).status,
      ).toBe(403);
      const response = await app.request("http://127.0.0.1:4317/api/works/list", {
        method: "POST",
        body: "{}",
        headers: headers({ origin: "http://127.0.0.1:4317" }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      temp.cleanup();
    }
  });

  it("下发带 nonce 的 HTML 和内容安全策略", async () => {
    const temp = assets();
    try {
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services: fakeServices(),
        logger,
      });
      const first = await app.request("http://127.0.0.1:4317/", { headers: { host: "127.0.0.1:4317" } });
      const second = await app.request("http://127.0.0.1:4317/", { headers: { host: "127.0.0.1:4317" } });
      const firstHtml = await first.text();
      const secondHtml = await second.text();
      const firstNonce = /<script nonce="([^"]+)">/.exec(firstHtml)?.[1];
      const secondNonce = /<script nonce="([^"]+)">/.exec(secondHtml)?.[1];
      expect(firstHtml).toContain('data-uw-appearance="system"');
      expect(firstNonce).toBeTruthy();
      expect(secondNonce).not.toBe(firstNonce);
      expect(first.headers.get("content-security-policy")).toContain(`'nonce-${firstNonce}'`);
      expect(first.headers.get("cache-control")).toBe("no-store");
    } finally {
      temp.cleanup();
    }
  });

  it("只提供 assets 目录里的静态文件", async () => {
    const temp = assets();
    try {
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services: fakeServices(),
        logger,
      });
      const ok = await app.request("http://127.0.0.1:4317/assets/app.js", { headers: { host: "127.0.0.1:4317" } });
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toContain("immutable");
      expect(
        (await app.request("http://127.0.0.1:4317/assets/missing.js", { headers: { host: "127.0.0.1:4317" } })).status,
      ).toBe(404);
    } finally {
      temp.cleanup();
    }
  });

  it("把业务错误原样返回", async () => {
    const temp = assets();
    try {
      const services = fakeServices({
        library: {
          ...fakeServices().library,
          list: () => {
            throw appError("stale_head", "moved");
          },
        },
      });
      const app = createHttpApp({
        token,
        getPort: () => 4317,
        assets: loadClientAssets(temp.dir),
        services,
        logger,
      });
      const response = await app.request("http://127.0.0.1:4317/api/works/list", {
        method: "POST",
        body: "{}",
        headers: headers(),
      });
      expect(response.status).toBe(409);
    } finally {
      temp.cleanup();
    }
  });
});
