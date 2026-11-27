import { randomUUID } from 'node:crypto';
import {
  LlmHttpExchangeSchema,
  LlmLogContentSchema,
  type LlmHttpExchange,
  type LlmLogContent,
} from '@unwritten/contracts';
import { createGuardedFetch, createFetchRecorder, unguardedFetch } from './fetch-guard.ts';
import { classifyFailure } from './classify.ts';
import { scrubSecrets } from '../log/scrub.ts';
import { completeOnce, createAgentSession, type CompletionOutcome, type RuntimeTarget } from './pi.ts';
import type { LlmCompleteInput, LlmCompleteResult, LlmRunInput, LlmRunRef, LlmRunResult } from './types.ts';
import { LlmRunError } from './types.ts';
import type { Database } from '../store/db.ts';
import { llmCallLogs, llmCalls } from '../store/schema.ts';
import type { Logger } from '../log/logger.ts';

export interface LlmTimeouts {
  firstOutputMs: number;
  stallMs: number;
}

export const DEFAULT_TIMEOUTS: LlmTimeouts = { firstOutputMs: 120_000, stallMs: 60_000 };
export const MAX_TOOL_ROUNDS = 8;
export const MAX_NUDGES = 2;
export const RATE_LIMIT_RETRY_DELAY_MS = 2_000;
const RETRYABLE: ReadonlySet<string> = new Set(['network', 'timeout', 'server', 'rate_limited']);

export interface RunnerDeps {
  db: Database;
  logger: Logger;
  shutdown: AbortSignal;
  timeouts?: Partial<LlmTimeouts>;
  logBodies: boolean;
  targetFor(purpose: LlmRunInput['purpose']): RuntimeTarget | null;
}

interface LlmCallLog {
  system: string;
  prompt: string;
  response: LlmLogContent[] | null;
  http: LlmHttpExchange[];
}

export function opencodeHeaders(baseUrl: string, sessionId: string): Record<string, string> {
  try {
    if (new URL(baseUrl).hostname !== 'opencode.ai') return {};
  } catch {
    return {};
  }
  return { 'x-opencode-client': 'unwritten', 'x-opencode-session': sessionId };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

interface Watchdog {
  readonly startedAt: number;
  readonly firstOutputAt: number | null;
  readonly timedOut: boolean;
  onOutput(): void;
  clear(): void;
}

function startWatchdog(timeouts: LlmTimeouts, controller: AbortController): Watchdog {
  const startedAt = performance.now();
  let firstOutputAt: number | null = null;
  let timedOut = false;
  const expire = () => {
    timedOut = true;
    controller.abort();
  };
  let firstTimer: ReturnType<typeof setTimeout> | null = setTimeout(expire, timeouts.firstOutputMs);
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (firstTimer) clearTimeout(firstTimer);
    if (stallTimer) clearTimeout(stallTimer);
    firstTimer = null;
    stallTimer = null;
  };
  return {
    startedAt,
    get firstOutputAt() {
      return firstOutputAt;
    },
    get timedOut() {
      return timedOut;
    },
    onOutput() {
      if (firstOutputAt === null) {
        firstOutputAt = performance.now();
        if (firstTimer) clearTimeout(firstTimer);
        firstTimer = null;
      }
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(expire, timeouts.stallMs);
    },
    clear,
  };
}

const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cost: 0, costFromProvider: false };

function scrubArguments(argumentsValue: Record<string, unknown>, secret: string | undefined): Record<string, unknown> {
  if (!secret) return argumentsValue;
  try {
    return JSON.parse(scrubSecrets(JSON.stringify(argumentsValue), [secret])) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function scrubContent(content: LlmLogContent[], secret: string | undefined): LlmLogContent[] {
  return content.map((part) => {
    if (part.type === 'text') return { ...part, text: scrubSecrets(part.text, [secret]) };
    if (part.type === 'thinking') return { ...part, thinking: scrubSecrets(part.thinking, [secret]) };
    return {
      ...part,
      arguments: scrubArguments(part.arguments, secret),
      ...(part.argumentsError ? { argumentsError: scrubSecrets(part.argumentsError, [secret]) } : {}),
    };
  });
}

function scrubExchange(exchange: LlmHttpExchange, secret: string | undefined): LlmHttpExchange {
  return {
    ...exchange,
    url: scrubSecrets(exchange.url, [secret]),
    requestBody: exchange.requestBody === null ? null : scrubSecrets(exchange.requestBody, [secret]),
    responseBody: exchange.responseBody === null ? null : scrubSecrets(exchange.responseBody, [secret]),
    error: exchange.error === null ? null : scrubSecrets(exchange.error, [secret]),
  };
}

function recordCall(
  deps: RunnerDeps,
  call: {
    callId: string;
    purpose: LlmRunInput['purpose'];
    ref: LlmRunRef;
    target: RuntimeTarget;
    outcome: CompletionOutcome | null;
    code: LlmRunError['code'] | undefined;
    watchdog: Watchdog;
    httpStatus: number | null;
    log: LlmCallLog | null;
  },
): void {
  const { callId, ref, target, outcome, code, watchdog } = call;
  const usage = outcome?.usage ?? EMPTY_USAGE;
  const status = code === undefined ? 'ok' : code === 'interrupted' ? 'aborted' : 'error';
  const createdAt = Date.now();
  deps.db
    .insert(llmCalls)
    .values({
      id: callId,
      purpose: call.purpose,
      workId: ref.workId,
      provider: target.endpointId,
      model: target.modelId,
      refKind: ref.kind,
      refId: ref.id,
      inputTokens: outcome ? usage.input : null,
      outputTokens: outcome ? usage.output : null,
      cacheReadTokens: outcome ? usage.cacheRead : null,
      cost: outcome ? usage.cost : null,
      costFromProvider: outcome ? (usage.costFromProvider ? 1 : 0) : null,
      durationMs: Math.round(performance.now() - watchdog.startedAt),
      status,
      error: code ?? null,
      createdAt,
    })
    .run();

  if (call.log) {
    const secret = target.apiKey;
    try {
      deps.db
        .insert(llmCallLogs)
        .values({
          callId,
          workId: ref.workId,
          system: scrubSecrets(call.log.system, [secret]),
          prompt: scrubSecrets(call.log.prompt, [secret]),
          response:
            call.log.response === null
              ? null
              : LlmLogContentSchema.array().parse(scrubContent(call.log.response, secret)),
          http: LlmHttpExchangeSchema.array().parse(call.log.http.map((exchange) => scrubExchange(exchange, secret))),
          createdAt,
        })
        .run();
    } catch {
      deps.logger.record({ level: 'warn', module: 'llm', event: 'llm.log.failed', callId });
    }
  }

  const requestId = ref.kind === 'turn_request' ? ref.id : undefined;
  const jobId = ref.kind === 'job' ? ref.id : undefined;
  deps.logger.record({
    level: code ? 'warn' : 'info',
    module: 'llm',
    event: 'llm.call',
    callId,
    requestId,
    jobId,
    workId: ref.workId ?? undefined,
    data: {
      status,
      code: code ?? null,
      attempt: ref.attempt,
      thinking: target.params.thinking,
      httpStatus: call.httpStatus,
    },
  });
  if (watchdog.firstOutputAt !== null) {
    deps.logger.sample({
      metric: 'llm.first_output',
      durationMs: watchdog.firstOutputAt - watchdog.startedAt,
      outcome: code === undefined ? 'ok' : code === 'interrupted' ? 'interrupted' : 'error',
      callId,
      requestId,
      jobId,
      attempt: ref.attempt,
    });
  }
}

function abortSignalFor(controller: AbortController, deps: RunnerDeps, signal: AbortSignal | undefined): AbortSignal {
  const signals = [controller.signal, deps.shutdown];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

interface AttemptResult {
  ok: boolean;
  code?: LlmRunError['code'];
  detail: string | null;
  gotOutput: boolean;
  streamStarted: boolean;
}

export function createRunner(deps: RunnerDeps): (input: LlmRunInput) => Promise<LlmRunResult> {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...deps.timeouts };

  const attemptOnce = async (input: LlmRunInput, target: RuntimeTarget): Promise<AttemptResult> => {
    const recorder = createFetchRecorder(deps.logBodies);
    const guardedFetch = createGuardedFetch(unguardedFetch(), recorder);
    const controller = new AbortController();
    const signal = abortSignalFor(controller, deps, input.signal);
    const callId = randomUUID();
    const watchdog = startWatchdog(timeouts, controller);
    const state = { terminated: false, gotOutput: false, tooManyRounds: false, rounds: 0 };

    const onActivity = (kind: 'output' | 'turn_end') => {
      if (kind === 'output') {
        state.gotOutput = true;
        watchdog.onOutput();
        return;
      }
      state.rounds += 1;
      if (state.rounds > MAX_TOOL_ROUNDS) {
        state.tooManyRounds = true;
        controller.abort();
      }
    };

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
        outcome.stopReason !== 'error' &&
        outcome.stopReason !== 'aborted' &&
        !state.terminated &&
        nudges < MAX_NUDGES
      ) {
        nudges += 1;
        outcome = await session.prompt(`请调用 ${input.requiredToolName} 提交结果，不要直接回复文字。`);
      }
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    } finally {
      watchdog.clear();
    }

    const errorMessage = thrown ?? outcome?.errorMessage ?? '';
    let code: LlmRunError['code'] | undefined;
    if (state.tooManyRounds) code = 'invalid_output';
    else if (thrown || outcome?.stopReason === 'error' || outcome?.stopReason === 'aborted') {
      code = classifyFailure({
        httpStatus: recorder.lastStatus,
        redirected: recorder.redirected,
        timedOut: watchdog.timedOut,
        aborted: Boolean(input.signal?.aborted || deps.shutdown.aborted),
        errorMessage,
      });
    } else if (!state.terminated) code = 'invalid_output';

    await recorder.flush();
    recordCall(deps, {
      callId,
      purpose: input.purpose,
      ref: input.ref,
      target,
      outcome,
      code,
      watchdog,
      httpStatus: recorder.lastStatus,
      log: deps.logBodies
        ? {
            system: input.system,
            prompt: input.prompt,
            response: outcome?.content ?? null,
            http: recorder.exchanges,
          }
        : null,
    });

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
    if (!target) throw new LlmRunError('llm_not_configured', null);

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
      if (!retry) throw new LlmRunError(result.code ?? 'invalid_output', result.detail);
      if (result.code === 'rate_limited') await wait(RATE_LIMIT_RETRY_DELAY_MS, deps.shutdown);
    }
    throw new LlmRunError('invalid_output', null);
  };
}

export function createCompleter(deps: RunnerDeps): (input: LlmCompleteInput) => Promise<LlmCompleteResult> {
  const timeouts = { ...DEFAULT_TIMEOUTS, ...deps.timeouts };

  return async (input) => {
    const target = deps.targetFor(input.purpose);
    if (!target) throw new LlmRunError('llm_not_configured', null);

    for (let index = 0; index < 2; index += 1) {
      const callId = randomUUID();
      const recorder = createFetchRecorder(deps.logBodies);
      const guardedFetch = createGuardedFetch(unguardedFetch(), recorder);
      const controller = new AbortController();
      const signal = abortSignalFor(controller, deps, input.signal);
      const watchdog = startWatchdog(timeouts, controller);

      let outcome: CompletionOutcome | null = null;
      let thrown: string | null = null;
      try {
        outcome = await completeOnce(
          target,
          {
            fetch: guardedFetch,
            headers: opencodeHeaders(target.baseUrl, input.sessionId),
            sessionId: input.sessionId,
            signal,
          },
          {
            system: input.system,
            user: input.prompt,
            tools: [],
            maxTokens: input.maxOutputTokens,
            onOutput: () => watchdog.onOutput(),
          },
        );
      } catch (error) {
        thrown = error instanceof Error ? error.message : String(error);
      } finally {
        watchdog.clear();
      }

      const errorMessage = thrown ?? outcome?.errorMessage ?? '';
      let code: LlmRunError['code'] | undefined;
      if (thrown || outcome?.stopReason === 'error' || outcome?.stopReason === 'aborted') {
        code = classifyFailure({
          httpStatus: recorder.lastStatus,
          redirected: recorder.redirected,
          timedOut: watchdog.timedOut,
          aborted: Boolean(input.signal?.aborted || deps.shutdown.aborted),
          errorMessage,
        });
      } else if (!outcome?.text.trim()) {
        code = 'invalid_output';
      }

      await recorder.flush();
      recordCall(deps, {
        callId,
        purpose: input.purpose,
        ref: input.ref,
        target,
        outcome,
        code,
        watchdog,
        httpStatus: recorder.lastStatus,
        log: deps.logBodies
          ? {
              system: input.system,
              prompt: input.prompt,
              response: outcome?.content ?? null,
              http: recorder.exchanges,
            }
          : null,
      });

      if (code === undefined) return { text: (outcome?.text ?? '').trim() };

      const gotOutput = Boolean(outcome?.text.trim());
      const retry =
        index === 0 && RETRYABLE.has(code) && !gotOutput && !input.signal?.aborted && !deps.shutdown.aborted;
      if (!retry) {
        const detail = errorMessage ? scrubSecrets(errorMessage, [target.apiKey]).slice(0, 500) : null;
        throw new LlmRunError(code, detail);
      }
      if (code === 'rate_limited') await wait(RATE_LIMIT_RETRY_DELAY_MS, deps.shutdown);
    }
    throw new LlmRunError('invalid_output', null);
  };
}
