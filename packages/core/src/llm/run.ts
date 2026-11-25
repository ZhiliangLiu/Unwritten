import { randomUUID } from "node:crypto";
import { createGuardedFetch, createFetchRecorder, unguardedFetch } from "./fetch-guard.ts";
import { classifyFailure } from "./classify.ts";
import { scrubSecrets } from "../log/scrub.ts";
import { createAgentSession, type CompletionOutcome, type RuntimeTarget } from "./pi.ts";
import type { LlmRunInput, LlmRunResult } from "./types.ts";
import { LlmRunError } from "./types.ts";
import type { Database } from "../store/db.ts";
import { llmCalls } from "../store/schema.ts";
import type { Logger } from "../log/logger.ts";

export interface LlmTimeouts {
  firstOutputMs: number;
  stallMs: number;
}

export const DEFAULT_TIMEOUTS: LlmTimeouts = { firstOutputMs: 120_000, stallMs: 60_000 };
export const MAX_TOOL_ROUNDS = 8;
export const MAX_NUDGES = 2;
export const RATE_LIMIT_RETRY_DELAY_MS = 2_000;
const RETRYABLE: ReadonlySet<string> = new Set(["network", "timeout", "server", "rate_limited"]);

export interface RunnerDeps {
  db: Database;
  logger: Logger;
  shutdown: AbortSignal;
  timeouts?: Partial<LlmTimeouts>;
  targetFor(purpose: LlmRunInput["purpose"]): RuntimeTarget | null;
}

export function opencodeHeaders(baseUrl: string, sessionId: string): Record<string, string> {
  try {
    if (new URL(baseUrl).hostname !== "opencode.ai") return {};
  } catch {
    return {};
  }
  return { "x-opencode-client": "unwritten", "x-opencode-session": sessionId };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

interface AttemptResult {
  ok: boolean;
  code?: LlmRunError["code"];
  detail: string | null;
  gotOutput: boolean;
  streamStarted: boolean;
}

export function createRunner(deps: RunnerDeps): (input: LlmRunInput) => Promise<LlmRunResult> {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...deps.timeouts };

  const attemptOnce = async (input: LlmRunInput, target: RuntimeTarget): Promise<AttemptResult> => {
    const recorder = createFetchRecorder();
    const guardedFetch = createGuardedFetch(unguardedFetch(), recorder);
    const controller = new AbortController();
    const signals = [controller.signal, deps.shutdown];
    if (input.signal) signals.push(input.signal);
    const signal = AbortSignal.any(signals);
    const callId = randomUUID();
    const startedAt = performance.now();
    let firstOutputAt: number | null = null;
    let firstTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const state = { terminated: false, gotOutput: false, tooManyRounds: false, timedOut: false, rounds: 0 };

    const clearTimers = () => {
      if (firstTimer) clearTimeout(firstTimer);
      if (stallTimer) clearTimeout(stallTimer);
      firstTimer = null;
      stallTimer = null;
    };

    const onActivity = (kind: "output" | "turn_end") => {
      if (kind === "output") {
        state.gotOutput = true;
        if (firstOutputAt === null) {
          firstOutputAt = performance.now();
          if (firstTimer) clearTimeout(firstTimer);
          firstTimer = null;
        }
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          state.timedOut = true;
          controller.abort();
        }, timeouts.stallMs);
        return;
      }
      state.rounds += 1;
      if (state.rounds > MAX_TOOL_ROUNDS) {
        state.tooManyRounds = true;
        controller.abort();
      }
    };

    firstTimer = setTimeout(() => {
      state.timedOut = true;
      controller.abort();
    }, timeouts.firstOutputMs);

    const wrappedTools = input.tools.map((tool) => {
      if (tool.name !== input.requiredToolName) return tool;
      return {
        ...tool,
        async execute(args: Record<string, unknown>) {
          const result = await tool.execute(args);
          if (result.terminate) state.terminated = true;
          return result;
        },
      };
    });

    let outcome: CompletionOutcome | null = null;
    let thrown: string | null = null;
    try {
      const session = createAgentSession(
        target,
        {
          fetch: guardedFetch,
          headers: opencodeHeaders(target.baseUrl, input.sessionId),
          sessionId: input.sessionId,
          signal,
        },
        { system: input.system, tools: wrappedTools, onActivity },
      );
      outcome = await session.prompt(input.prompt);
      let nudges = 0;
      while (
        outcome.stopReason !== "error" &&
        outcome.stopReason !== "aborted" &&
        !state.terminated &&
        nudges < MAX_NUDGES
      ) {
        nudges += 1;
        outcome = await session.prompt(`请调用 ${input.requiredToolName} 提交结果，不要直接回复文字。`);
      }
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimers();
    }

    const errorMessage = thrown ?? outcome?.errorMessage ?? "";
    let code: LlmRunError["code"] | undefined;
    if (state.tooManyRounds) code = "invalid_output";
    else if (thrown || outcome?.stopReason === "error" || outcome?.stopReason === "aborted") {
      code = classifyFailure({
        httpStatus: recorder.lastStatus,
        redirected: recorder.redirected,
        timedOut: state.timedOut,
        aborted: Boolean(input.signal?.aborted || deps.shutdown.aborted),
        errorMessage,
      });
    } else if (!state.terminated) code = "invalid_output";

    const usage = outcome?.usage ?? { input: 0, output: 0, cacheRead: 0, cost: 0, costFromProvider: false };
    const status = code === undefined ? "ok" : code === "interrupted" ? "aborted" : "error";
    deps.db
      .insert(llmCalls)
      .values({
        id: callId,
        purpose: input.purpose,
        workId: input.ref.workId,
        provider: target.endpointId,
        model: target.modelId,
        refKind: input.ref.kind,
        refId: input.ref.id,
        inputTokens: outcome ? usage.input : null,
        outputTokens: outcome ? usage.output : null,
        cacheReadTokens: outcome ? usage.cacheRead : null,
        cost: outcome ? usage.cost : null,
        costFromProvider: outcome ? (usage.costFromProvider ? 1 : 0) : null,
        durationMs: Math.round(performance.now() - startedAt),
        status,
        error: code ?? null,
        createdAt: Date.now(),
      })
      .run();

    deps.logger.record({
      level: code ? "warn" : "info",
      module: "llm",
      event: "llm.call",
      callId,
      requestId: input.ref.kind === "turn_request" ? input.ref.id : undefined,
      jobId: input.ref.kind === "job" ? input.ref.id : undefined,
      data: { status, code: code ?? null, attempt: input.ref.attempt },
    });
    if (firstOutputAt !== null) {
      deps.logger.sample({
        metric: "llm.first_output",
        durationMs: firstOutputAt - startedAt,
        outcome: code === undefined ? "ok" : code === "interrupted" ? "interrupted" : "error",
        callId,
        requestId: input.ref.kind === "turn_request" ? input.ref.id : undefined,
        jobId: input.ref.kind === "job" ? input.ref.id : undefined,
        attempt: input.ref.attempt,
      });
    }

    return {
      ok: code === undefined,
      code,
      detail: errorMessage ? scrubSecrets(errorMessage, [target.apiKey]).slice(0, 500) : null,
      gotOutput: state.gotOutput,
      streamStarted: recorder.lastStatus !== null && recorder.lastStatus >= 200 && recorder.lastStatus < 300,
    };
  };

  return async (input) => {
    const target = deps.targetFor(input.purpose);
    if (!target) throw new LlmRunError("llm_not_configured", null);

    for (let index = 0; index < 2; index += 1) {
      const result = await attemptOnce(input, target);
      if (result.ok) return { requiredToolTerminated: true };
      const retry =
        index === 0 &&
        result.code !== undefined &&
        RETRYABLE.has(result.code) &&
        !result.gotOutput &&
        !result.streamStarted &&
        !input.signal?.aborted &&
        !deps.shutdown.aborted;
      if (!retry) throw new LlmRunError(result.code ?? "invalid_output", result.detail);
      if (result.code === "rate_limited") await wait(RATE_LIMIT_RETRY_DELAY_MS, deps.shutdown);
    }
    throw new LlmRunError("invalid_output", null);
  };
}
