import { randomUUID } from 'node:crypto';
import type { TestConnectionInput, TestConnectionResult } from '@unwritten/contracts';
import { EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { Logger } from '../log/logger.ts';
import { DEFAULT_CONTEXT_WINDOW, defaultMaxTokens } from './budget.ts';
import { classifyFailure } from './classify.ts';
import { createFetchRecorder, createGuardedFetch, unguardedFetch } from './fetch-guard.ts';
import { resolveApiKey } from './keys.ts';
import { completeOnce, type RuntimeTarget } from './pi.ts';
import type { ProvidersStore } from './providers-file.ts';
import { opencodeHeaders } from './run.ts';
import { scrubSecrets } from '../log/scrub.ts';
import type { LlmTool, Purpose } from './types.ts';
import { normalizeBaseUrl } from './url.ts';

const TEST_CONNECTION_TIMEOUT_MS = 20_000;

const PING_TOOL: LlmTool = {
  name: 'ping',
  description: '确认连接可用',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async execute() {
    return { text: 'pong', terminate: true };
  },
};

export interface ConnectionTesterDeps {
  store: ProvidersStore;
  logger: Logger;
  shutdown: AbortSignal;
  env: NodeJS.ProcessEnv;
  targetFor(purpose: Purpose | 'default'): RuntimeTarget | null;
}

interface SavedEndpoint {
  endpointId: string;
  baseUrl: string;
  modelId: string;
}

export function createConnectionTester(
  deps: ConnectionTesterDeps,
): (input: TestConnectionInput) => Promise<TestConnectionResult> {
  const record = (result: TestConnectionResult, httpStatus: number | null = null): TestConnectionResult => {
    const diagnosticId = result.ok ? undefined : randomUUID();
    deps.logger.record({
      level: result.ok ? 'info' : 'warn',
      module: 'llm',
      event: 'llm.test',
      id: diagnosticId,
      data: { ok: result.ok, code: result.code, httpStatus },
    });
    return diagnosticId ? { ...result, diagnosticId } : result;
  };

  const runPing = async (
    target: RuntimeTarget,
    startedAt: number,
    saved: SavedEndpoint | null,
  ): Promise<TestConnectionResult> => {
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
          headers: opencodeHeaders(target.baseUrl, 'connection-test'),
          sessionId: 'connection-test',
          signal,
        },
        {
          system: '你在做连接测试。只调用 ping 工具，不要输出其他内容。',
          user: '调用 ping。',
          tools: [PING_TOOL],
          maxTokens: 1024,
        },
      );

      if (outcome.stopReason === 'error' || outcome.stopReason === 'aborted') {
        let code = classifyFailure({
          httpStatus: recorder.lastStatus,
          redirected: recorder.redirected,
          timedOut,
          aborted: deps.shutdown.aborted,
          errorMessage: outcome.errorMessage ?? '',
        });
        if (code === 'network' && recorder.lastStatus === null) code = 'unreachable';
        if (code === 'interrupted' && timedOut) code = 'timeout';
        const detail = outcome.errorMessage ? scrubSecrets(outcome.errorMessage, [target.apiKey]).slice(0, 500) : null;
        deps.logger.sample({
          metric: 'llm.connection_test',
          durationMs: performance.now() - startedAt,
          outcome: 'error',
        });
        return record({ ok: false, code, detail, savedToolsCapability: false }, recorder.lastStatus);
      }

      if (!outcome.calledToolNames.includes('ping')) {
        deps.logger.sample({
          metric: 'llm.connection_test',
          durationMs: performance.now() - startedAt,
          outcome: 'error',
        });
        return record(
          { ok: false, code: 'no_tool_call', detail: null, savedToolsCapability: false },
          recorder.lastStatus,
        );
      }

      let savedToolsCapability = false;
      if (saved) {
        savedToolsCapability = await deps.store.enqueue(() => {
          const state = deps.store.load();
          if (state.status !== 'ok') return false;
          const endpoint = state.file.endpoints.find((candidate) => candidate.id === saved.endpointId);
          if (!endpoint || endpoint.baseUrl !== saved.baseUrl) return false;
          const model = endpoint.models.find((candidate) => candidate.id === saved.modelId);
          if (!model) return false;
          if (model.tools === true) return true;
          const file = structuredClone(state.file);
          const targetEndpoint = file.endpoints.find((candidate) => candidate.id === saved.endpointId);
          const targetModel = targetEndpoint?.models.find((candidate) => candidate.id === saved.modelId);
          if (!targetModel) return false;
          targetModel.tools = true;
          deps.store.write(file);
          return true;
        });
      }

      deps.logger.sample({ metric: 'llm.connection_test', durationMs: performance.now() - startedAt, outcome: 'ok' });
      return record({ ok: true, code: null, detail: null, savedToolsCapability }, recorder.lastStatus);
    } finally {
      clearTimeout(timer);
    }
  };

  return async (input) => {
    const startedAt = performance.now();
    if ('purpose' in input) {
      const target = deps.targetFor(input.purpose);
      if (!target) {
        deps.logger.sample({
          metric: 'llm.connection_test',
          durationMs: performance.now() - startedAt,
          outcome: 'error',
        });
        return record({ ok: false, code: 'llm_not_configured', detail: null, savedToolsCapability: false });
      }
      return runPing(target, startedAt, null);
    }

    const baseUrl = normalizeBaseUrl(input.baseUrl);
    if (!baseUrl) {
      deps.logger.sample({
        metric: 'llm.connection_test',
        durationMs: performance.now() - startedAt,
        outcome: 'error',
      });
      return record({ ok: false, code: 'invalid_url', detail: null, savedToolsCapability: false });
    }

    let rawKey: string | undefined;
    let saved: SavedEndpoint | null = null;
    const key = input.key;
    if (key.action === 'set') rawKey = key.value;
    else if (key.action === 'keep') {
      const state = deps.store.load();
      if (state.status !== 'ok') throw appError('endpoint_not_found', 'endpoint is not available');
      const endpoint = state.file.endpoints.find((candidate) => candidate.id === key.endpointId);
      if (!endpoint) throw appError('endpoint_not_found', 'endpoint not found');
      rawKey = endpoint.apiKey;
      saved = { endpointId: endpoint.id, baseUrl, modelId: input.modelId };
    }
    const apiKey = resolveApiKey(rawKey, deps.env);
    const target: RuntimeTarget = {
      endpointId: 'connection-test',
      endpointName: 'Connection test',
      baseUrl,
      modelId: input.modelId,
      apiKey,
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxOutputTokens: defaultMaxTokens(DEFAULT_CONTEXT_WINDOW),
      thinkingFormat: 'auto',
      params: EMPTY_GENERATION_PARAMS,
    };

    return runPing(target, startedAt, saved);
  };
}
