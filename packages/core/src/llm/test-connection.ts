import type { TestConnectionInput, TestConnectionResult } from "@unwritten/contracts";
import { appError } from "../errors.ts";
import type { Logger } from "../log/logger.ts";
import { DEFAULT_CONTEXT_WINDOW, defaultMaxTokens } from "./budget.ts";
import { classifyFailure } from "./classify.ts";
import { createFetchRecorder, createGuardedFetch, unguardedFetch } from "./fetch-guard.ts";
import { resolveApiKey } from "./keys.ts";
import { completeOnce, type RuntimeTarget } from "./pi.ts";
import type { ProvidersStore } from "./providers-file.ts";
import { opencodeHeaders } from "./run.ts";
import { scrubSecrets } from "../log/scrub.ts";
import type { LlmTool } from "./types.ts";
import { normalizeBaseUrl } from "./url.ts";

const TEST_CONNECTION_TIMEOUT_MS = 20_000;

const PING_TOOL: LlmTool = {
  name: "ping",
  description: "确认连接可用",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    return { text: "pong", terminate: true };
  },
};

export interface ConnectionTesterDeps {
  store: ProvidersStore;
  logger: Logger;
  shutdown: AbortSignal;
  env: NodeJS.ProcessEnv;
}

export function createConnectionTester(
  deps: ConnectionTesterDeps,
): (input: TestConnectionInput) => Promise<TestConnectionResult> {
  const record = (result: TestConnectionResult) => {
    deps.logger.record({
      level: result.ok ? "info" : "warn",
      module: "llm",
      event: "llm.test",
      data: { ok: result.ok, code: result.code },
    });
    return result;
  };

  return async (input) => {
    const startedAt = performance.now();
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    if (!baseUrl) {
      deps.logger.sample({
        metric: "llm.connection_test",
        durationMs: performance.now() - startedAt,
        outcome: "error",
      });
      return record({ ok: false, code: "invalid_url", detail: null, savedToolsCapability: false });
    }

    let rawKey: string | undefined;
    let endpointId: string | null = null;
    const key = input.key;
    if (key.action === "set") rawKey = key.value;
    else if (key.action === "keep") {
      const state = deps.store.load();
      if (state.status !== "ok") throw appError("endpoint_not_found", "endpoint is not available");
      const endpoint = state.file.endpoints.find((candidate) => candidate.id === key.endpointId);
      if (!endpoint) throw appError("endpoint_not_found", "endpoint not found");
      rawKey = endpoint.apiKey;
      endpointId = endpoint.id;
    }
    const apiKey = resolveApiKey(rawKey, deps.env);
    const target: RuntimeTarget = {
      endpointId: "connection-test",
      endpointName: "Connection test",
      baseUrl,
      modelId: input.modelId,
      apiKey,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxOutputTokens: defaultMaxTokens(DEFAULT_CONTEXT_WINDOW),
    };

    const recorder = createFetchRecorder();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TEST_CONNECTION_TIMEOUT_MS);
    const signal = AbortSignal.any([controller.signal, deps.shutdown]);

    try {
      const outcome = await completeOnce(
        target,
        {
          fetch: createGuardedFetch(unguardedFetch(), recorder),
          headers: opencodeHeaders(baseUrl, "connection-test"),
          sessionId: "connection-test",
          signal,
        },
        {
          system: "你在做连接测试。只调用 ping 工具，不要输出其他内容。",
          user: "调用 ping。",
          tools: [PING_TOOL],
          maxTokens: 1024,
        },
      );

      if (outcome.stopReason === "error" || outcome.stopReason === "aborted") {
        let code = classifyFailure({
          httpStatus: recorder.lastStatus,
          redirected: recorder.redirected,
          timedOut,
          aborted: deps.shutdown.aborted,
          errorMessage: outcome.errorMessage ?? "",
        });
        if (code === "network" && recorder.lastStatus === null) code = "unreachable";
        if (code === "interrupted" && timedOut) code = "timeout";
        const detail = outcome.errorMessage ? scrubSecrets(outcome.errorMessage, [apiKey]).slice(0, 500) : null;
        deps.logger.sample({
          metric: "llm.connection_test",
          durationMs: performance.now() - startedAt,
          outcome: "error",
        });
        return record({ ok: false, code, detail, savedToolsCapability: false });
      }

      if (!outcome.calledToolNames.includes("ping")) {
        deps.logger.sample({
          metric: "llm.connection_test",
          durationMs: performance.now() - startedAt,
          outcome: "error",
        });
        return record({ ok: false, code: "no_tool_call", detail: null, savedToolsCapability: false });
      }

      let savedToolsCapability = false;
      if (endpointId) {
        savedToolsCapability = await deps.store.enqueue(() => {
          const state = deps.store.load();
          if (state.status !== "ok") return false;
          const endpoint = state.file.endpoints.find((candidate) => candidate.id === endpointId);
          if (!endpoint || endpoint.baseUrl !== baseUrl) return false;
          const model = endpoint.models.find((candidate) => candidate.id === input.modelId);
          if (!model) return false;
          if (model.tools === true) return true;
          const file = structuredClone(state.file);
          const targetEndpoint = file.endpoints.find((candidate) => candidate.id === endpointId);
          const targetModel = targetEndpoint?.models.find((candidate) => candidate.id === input.modelId);
          if (!targetModel) return false;
          targetModel.tools = true;
          deps.store.write(file);
          return true;
        });
      }

      deps.logger.sample({ metric: "llm.connection_test", durationMs: performance.now() - startedAt, outcome: "ok" });
      return record({ ok: true, code: null, detail: null, savedToolsCapability });
    } finally {
      clearTimeout(timer);
    }
  };
}
