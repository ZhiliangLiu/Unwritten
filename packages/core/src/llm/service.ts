import { join } from 'node:path';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { PURPOSES } from '@unwritten/contracts';
import type {
  AddModelInput,
  CreateEndpointInput,
  CreateEndpointOutput,
  EndpointView,
  GenerationParams,
  LlmConfigView,
  LlmLogDetail,
  LlmLogIdInput,
  LlmLogList,
  LlmLogListInput,
  LlmLogStatus,
  LlmLogSummary,
  ModelRef,
  PurposeView,
  RemoveEndpointInput,
  RemoveModelInput,
  SetPurposeInput,
  TestConnectionInput,
  TestConnectionResult,
  ThinkingFormat,
  UpdateEndpointInput,
  UpdateModelInput,
} from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { CoreDeps, LlmService } from '../services.ts';
import { llmCallLogs, llmCalls } from '../store/schema.ts';
import { keyStatus, resolveApiKey } from './keys.ts';
import { DEFAULT_CONTEXT_WINDOW, defaultMaxTokens, estimateTokens } from './budget.ts';
import { newEndpointId } from './endpoint-id.ts';
import { paramsFromFile, paramsProblem, paramsToFile, sanitizeParams } from './params.ts';
import { createProvidersStore, type ProvidersState } from './providers-file.ts';
import { createRunner, createCompleter, type LlmTimeouts } from './run.ts';
import { createConnectionTester } from './test-connection.ts';
import { normalizeBaseUrl } from './url.ts';
import type { Purpose } from './types.ts';
import type { EndpointEntry, ProvidersFile } from './providers-schema.ts';

const LLM_CALL_RETENTION_DAYS = 90;
const LLM_LOG_RETENTION_DAYS = 7;

const logSummaryColumns = {
  callId: llmCalls.id,
  purpose: llmCalls.purpose,
  workId: llmCalls.workId,
  provider: llmCalls.provider,
  model: llmCalls.model,
  refKind: llmCalls.refKind,
  refId: llmCalls.refId,
  status: llmCalls.status,
  error: llmCalls.error,
  inputTokens: llmCalls.inputTokens,
  outputTokens: llmCalls.outputTokens,
  durationMs: llmCalls.durationMs,
  createdAt: llmCalls.createdAt,
} as const;

function logSummaryOf(row: {
  callId: string;
  purpose: string;
  workId: string | null;
  provider: string;
  model: string;
  refKind: string | null;
  refId: string | null;
  status: 'ok' | 'error' | 'aborted';
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  createdAt: number;
}): LlmLogSummary {
  return {
    ...row,
    purpose: row.purpose as LlmLogSummary['purpose'],
    refKind: row.refKind as LlmLogSummary['refKind'],
  };
}

function endpointView(endpoint: EndpointEntry, env: NodeJS.ProcessEnv): EndpointView {
  return {
    id: endpoint.id,
    name: endpoint.name,
    api: endpoint.api,
    baseUrl: endpoint.baseUrl,
    key: keyStatus(endpoint.apiKey, env),
    models: endpoint.models.map((model) => ({
      id: model.id,
      contextWindow: model.contextWindow ?? null,
      maxTokens: model.maxTokens ?? null,
      tools: model.tools ?? null,
      reasoning: model.reasoning ?? null,
      thinkingFormat: model.thinkingFormat ?? 'auto',
    })),
  };
}

function foundModel(
  state: ProvidersState,
  ref: ModelRef,
): { endpoint: EndpointEntry; model: EndpointEntry['models'][number] } | null {
  if (state.status !== 'ok') return null;
  const endpoint = state.file.endpoints.find((candidate) => candidate.id === ref.endpointId);
  if (!endpoint) return null;
  const model = endpoint.models.find((candidate) => candidate.id === ref.modelId);
  return model ? { endpoint, model } : null;
}

function resolvedFor(
  state: ProvidersState,
  purpose: 'narrator' | 'author_chat' | 'background' | 'default',
): { endpoint: EndpointEntry; model: EndpointEntry['models'][number]; params: GenerationParams } | null {
  if (state.status !== 'ok') return null;
  const own = state.file.purposes[purpose];
  const ref = own ?? (purpose === 'default' ? undefined : state.file.purposes.default);
  if (!ref) return null;
  const found = foundModel(state, { endpointId: ref.provider, modelId: ref.model });
  if (!found) return null;
  if (found.endpoint.api !== 'openai-completions') return null;
  if ((purpose === 'narrator' || purpose === 'author_chat') && found.model.tools === false) return null;
  return { ...found, params: paramsFromFile(ref.params) };
}

function purposeViews(state: ProvidersState): PurposeView[] {
  if (state.status !== 'ok') return [];
  return PURPOSES.map((purpose) => {
    const own = state.file.purposes[purpose];
    const inherited = purpose !== 'default' && own === undefined;
    const effectiveRef = own ?? (purpose === 'default' ? undefined : state.file.purposes.default);
    const model = own ? { endpointId: own.provider, modelId: own.model } : null;
    const effectiveModel = effectiveRef ? { endpointId: effectiveRef.provider, modelId: effectiveRef.model } : null;
    let problem: PurposeView['problem'] = null;
    if (!effectiveRef) {
      problem = 'not_configured';
    } else {
      const found = foundModel(state, effectiveModel!);
      if (!found || found.endpoint.api !== 'openai-completions') {
        problem = 'model_missing';
      } else if ((purpose === 'narrator' || purpose === 'author_chat') && found.model.tools === false) {
        problem = 'no_tools';
      }
    }
    return {
      purpose,
      model,
      params: paramsFromFile(own?.params),
      inherited,
      effectiveModel,
      effectiveParams: paramsFromFile(effectiveRef?.params),
      problem,
    };
  });
}

export function createLlmService(
  deps: CoreDeps,
  options?: { env?: NodeJS.ProcessEnv; timeouts?: Partial<LlmTimeouts> },
): LlmService {
  const env = options?.env ?? process.env;
  let firstRevision: string | null = null;
  const store = createProvidersStore(join(deps.dataDir, 'providers.json'), (state) => {
    const first = firstRevision === null;
    firstRevision = state.revision;
    deps.logger.record({
      level: 'info',
      module: 'llm',
      event: 'llm.config.loaded',
      data: { status: state.status, revision: state.revision.slice(0, 8) },
    });
    if (!first) deps.bus.publish({ type: 'llm.config_changed' });
  });
  store.load();

  const view = (state: ProvidersState): LlmConfigView => {
    if (state.status !== 'ok') {
      return {
        status: state.status,
        revision: state.revision,
        problem: state.status === 'missing' ? null : state.problem,
        endpoints: [],
        purposes: [],
      };
    }
    return {
      status: 'ok',
      revision: state.revision,
      problem: null,
      endpoints: state.file.endpoints.map((endpoint) => endpointView(endpoint, env)),
      purposes: purposeViews(state),
    };
  };

  function ensureWritable(
    state: ProvidersState,
  ): asserts state is Extract<ProvidersState, { status: 'ok' | 'missing' }> {
    if (state.status === 'invalid') throw appError('llm_config_invalid', 'providers.json is invalid');
    if (state.status === 'too_new') throw appError('llm_config_too_new', 'providers.json is too new');
  }

  const writeConfig = (file: ProvidersFile): ProvidersState => {
    const state = store.write(file);
    deps.logger.record({
      level: 'info',
      module: 'llm',
      event: 'llm.config.written',
      data: { status: state.status, revision: state.revision.slice(0, 8) },
    });
    return state;
  };

  const targetFor = (purpose: Purpose | 'default') => {
    const found = resolvedFor(store.load(), purpose);
    if (!found) return null;
    const contextWindow = found.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    return {
      endpointId: found.endpoint.id,
      endpointName: found.endpoint.name,
      baseUrl: found.endpoint.baseUrl,
      modelId: found.model.id,
      apiKey: resolveApiKey(found.endpoint.apiKey, env),
      contextWindow,
      maxOutputTokens: found.model.maxTokens ?? defaultMaxTokens(contextWindow),
      thinkingFormat: found.model.thinkingFormat ?? 'auto',
      params: found.params,
    };
  };

  const logBodies = deps.dev ?? false;
  const runner = createRunner({
    db: deps.db,
    logger: deps.logger,
    shutdown: deps.shutdown,
    timeouts: options?.timeouts,
    logBodies,
    targetFor,
  });
  const completer = createCompleter({
    db: deps.db,
    logger: deps.logger,
    shutdown: deps.shutdown,
    timeouts: options?.timeouts,
    logBodies,
    targetFor,
  });
  const tester = createConnectionTester({
    store,
    logger: deps.logger,
    shutdown: deps.shutdown,
    env,
    targetFor,
  });

  return {
    listProviders() {
      return view(store.load());
    },
    async createEndpoint(input: CreateEndpointInput): Promise<CreateEndpointOutput> {
      const baseUrl = normalizeBaseUrl(input.baseUrl);
      if (!baseUrl) throw appError('invalid_url', 'invalid endpoint url');
      return store.enqueue(() => {
        const state = store.load();
        ensureWritable(state);
        const id = newEndpointId(input.name, input.requestId);
        const existing = state.file.endpoints.find((endpoint) => endpoint.id === id);
        if (existing) {
          const same =
            existing.name === input.name &&
            existing.baseUrl === baseUrl &&
            existing.models.some((model) => model.id === input.modelId);
          if (!same) throw appError('idempotency_conflict', 'endpoint id is already used');
          return { endpointId: id, config: view(state) };
        }
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        const endpoint: EndpointEntry = {
          id,
          name: input.name,
          api: 'openai-completions',
          baseUrl,
          models: [{ id: input.modelId }],
        };
        if (input.apiKey !== null) endpoint.apiKey = input.apiKey;
        file.endpoints.push(endpoint);
        if (input.makeDefault) file.purposes.default = { provider: id, model: input.modelId };
        const next = writeConfig(file);
        return { endpointId: id, config: view(next) };
      });
    },
    async updateEndpoint(input: UpdateEndpointInput): Promise<LlmConfigView> {
      return store.enqueue(() => {
        const state = store.load();
        ensureWritable(state);
        const endpoint = state.file.endpoints.find((candidate) => candidate.id === input.endpointId);
        if (!endpoint) throw appError('endpoint_not_found', 'endpoint not found');
        const originalKey = endpoint.apiKey;
        const targetKey =
          input.key.action === 'keep' ? originalKey : input.key.action === 'set' ? input.key.value : undefined;
        const same = endpoint.name === input.name && originalKey === targetKey;
        if (same) return view(state);
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        const target = file.endpoints.find((candidate) => candidate.id === input.endpointId);
        if (!target) throw appError('endpoint_not_found', 'endpoint not found');
        target.name = input.name;
        if (targetKey === undefined) delete target.apiKey;
        else target.apiKey = targetKey;
        const next = writeConfig(file);
        return view(next);
      });
    },
    async setPurpose(input: SetPurposeInput): Promise<LlmConfigView> {
      return store.enqueue(() => {
        const state = store.load();
        ensureWritable(state);
        if (input.model === null) {
          if (!state.file.purposes[input.purpose]) return view(state);
          if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
          const file = structuredClone(state.file);
          delete file.purposes[input.purpose];
          return view(writeConfig(file));
        }
        const found = foundModel(state, input.model);
        if (!found) throw appError('endpoint_not_found', 'endpoint or model not found');
        const model = {
          reasoning: found.model.reasoning ?? null,
          thinkingFormat: found.model.thinkingFormat ?? 'auto',
        };
        if (paramsProblem(input.params, model) !== null) {
          throw appError('thinking_unsupported', 'thinking settings are not supported by this model');
        }
        const params = paramsToFile(input.params);
        const existing = state.file.purposes[input.purpose];
        const same =
          existing &&
          existing.provider === input.model.endpointId &&
          existing.model === input.model.modelId &&
          JSON.stringify(existing.params ?? null) === JSON.stringify(params ?? null);
        if (same) return view(state);
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        const next: NonNullable<ProvidersFile['purposes']['default']> = {
          provider: input.model.endpointId,
          model: input.model.modelId,
        };
        if (params) next.params = params;
        file.purposes[input.purpose] = next;
        return view(writeConfig(file));
      });
    },
    async removeEndpoint(input: RemoveEndpointInput): Promise<LlmConfigView> {
      return store.enqueue(() => {
        const state = store.load();
        ensureWritable(state);
        if (!state.file.endpoints.some((endpoint) => endpoint.id === input.endpointId)) return view(state);
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        file.endpoints = file.endpoints.filter((endpoint) => endpoint.id !== input.endpointId);
        for (const purpose of ['default', 'narrator', 'author_chat', 'background'] as const) {
          const ref = file.purposes[purpose];
          if (ref?.provider === input.endpointId) delete file.purposes[purpose];
        }
        return view(writeConfig(file));
      });
    },
    async addModel(input: AddModelInput): Promise<LlmConfigView> {
      return store.enqueue(() => {
        const state = store.load();
        ensureWritable(state);
        const endpoint = state.file.endpoints.find((candidate) => candidate.id === input.endpointId);
        if (!endpoint) throw appError('endpoint_not_found', 'endpoint not found');
        if (endpoint.models.some((model) => model.id === input.modelId)) return view(state);
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        file.endpoints.find((candidate) => candidate.id === input.endpointId)?.models.push({ id: input.modelId });
        return view(writeConfig(file));
      });
    },
    async updateModel(input: UpdateModelInput): Promise<LlmConfigView> {
      return store.enqueue(() => {
        const state = store.load();
        ensureWritable(state);
        const endpoint = state.file.endpoints.find((candidate) => candidate.id === input.endpointId);
        const model = endpoint?.models.find((candidate) => candidate.id === input.modelId);
        if (!model) throw appError('endpoint_not_found', 'endpoint or model not found');
        const same =
          (model.reasoning ?? null) === input.reasoning && (model.thinkingFormat ?? 'auto') === input.thinkingFormat;
        if (same) return view(state);
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        const targetEndpoint = file.endpoints.find((candidate) => candidate.id === input.endpointId);
        const target = targetEndpoint?.models.find((candidate) => candidate.id === input.modelId);
        if (!target) throw appError('endpoint_not_found', 'endpoint or model not found');
        if (input.reasoning === null) delete target.reasoning;
        else target.reasoning = input.reasoning;
        if (input.thinkingFormat === 'auto') delete target.thinkingFormat;
        else target.thinkingFormat = input.thinkingFormat;
        const modelShape: { reasoning: boolean | null; thinkingFormat: ThinkingFormat } = {
          reasoning: target.reasoning ?? null,
          thinkingFormat: target.thinkingFormat ?? 'auto',
        };
        for (const purpose of ['default', 'narrator', 'author_chat', 'background'] as const) {
          const ref = file.purposes[purpose];
          if (!ref || ref.provider !== input.endpointId || ref.model !== input.modelId) continue;
          const sanitized = sanitizeParams(paramsFromFile(ref.params), modelShape);
          const params = paramsToFile(sanitized);
          if (params) ref.params = params;
          else delete ref.params;
        }
        return view(writeConfig(file));
      });
    },
    async removeModel(input: RemoveModelInput): Promise<LlmConfigView> {
      return store.enqueue(() => {
        const state = store.load();
        ensureWritable(state);
        const endpoint = state.file.endpoints.find((candidate) => candidate.id === input.endpointId);
        if (!endpoint || !endpoint.models.some((model) => model.id === input.modelId)) return view(state);
        if (endpoint.models.length === 1) throw appError('last_model', 'an endpoint needs at least one model');
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        const target = file.endpoints.find((candidate) => candidate.id === input.endpointId);
        if (target) target.models = target.models.filter((model) => model.id !== input.modelId);
        for (const purpose of ['default', 'narrator', 'author_chat', 'background'] as const) {
          const ref = file.purposes[purpose];
          if (ref?.provider === input.endpointId && ref.model === input.modelId) delete file.purposes[purpose];
        }
        return view(writeConfig(file));
      });
    },
    complete: completer,
    testConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
      return tester(input);
    },
    logsStatus(): LlmLogStatus {
      return { enabled: logBodies };
    },
    listLogs(input: LlmLogListInput): LlmLogList {
      if (!logBodies) return { items: [] };
      const rows = deps.db
        .select(logSummaryColumns)
        .from(llmCallLogs)
        .innerJoin(llmCalls, eq(llmCallLogs.callId, llmCalls.id))
        .where(
          input.before === undefined
            ? undefined
            : or(
                lt(llmCalls.createdAt, input.before.createdAt),
                and(eq(llmCalls.createdAt, input.before.createdAt), lt(llmCalls.id, input.before.callId)),
              ),
        )
        .orderBy(desc(llmCalls.createdAt), desc(llmCalls.id))
        .limit(input.limit)
        .all();
      return { items: rows.map(logSummaryOf) };
    },
    getLog(input: LlmLogIdInput): LlmLogDetail {
      if (!logBodies) throw appError('not_found', 'llm log is not enabled');
      const row = deps.db
        .select({
          ...logSummaryColumns,
          system: llmCallLogs.system,
          prompt: llmCallLogs.prompt,
          response: llmCallLogs.response,
          http: llmCallLogs.http,
        })
        .from(llmCallLogs)
        .innerJoin(llmCalls, eq(llmCallLogs.callId, llmCalls.id))
        .where(eq(llmCallLogs.callId, input.callId))
        .get();
      if (!row) throw appError('not_found', 'llm log not found');
      const { system, prompt, response, http, ...summary } = row;
      return { ...logSummaryOf(summary), system, prompt, response, http };
    },
    resolve(purpose) {
      const found = resolvedFor(store.load(), purpose);
      if (!found) return null;
      const contextWindow = found.model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
      return {
        endpointId: found.endpoint.id,
        modelId: found.model.id,
        contextWindow,
        maxOutputTokens: found.model.maxTokens ?? defaultMaxTokens(contextWindow),
      };
    },
    estimateTokens,
    run: runner,
    pruneCalls() {
      const now = Date.now();
      deps.db.run(sql`delete from llm_call_logs where created_at < ${now - LLM_LOG_RETENTION_DAYS * 86_400_000}`);
      const cutoff = now - LLM_CALL_RETENTION_DAYS * 86_400_000;
      const result = deps.db.run(sql`delete from llm_calls where created_at < ${cutoff}`);
      return Number(result.changes ?? 0);
    },
  };
}
