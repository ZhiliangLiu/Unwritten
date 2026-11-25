import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type {
  CreateEndpointInput,
  CreateEndpointOutput,
  EndpointView,
  LlmConfigView,
  ModelRef,
  SetPurposeInput,
  TestConnectionInput,
  TestConnectionResult,
  UpdateEndpointInput,
} from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { CoreDeps, LlmService } from '../services.ts';
import { keyStatus, resolveApiKey } from './keys.ts';
import { DEFAULT_CONTEXT_WINDOW, defaultMaxTokens, estimateTokens } from './budget.ts';
import { newEndpointId } from './endpoint-id.ts';
import { createProvidersStore, type ProvidersState } from './providers-file.ts';
import { createRunner, type LlmTimeouts } from './run.ts';
import { createConnectionTester } from './test-connection.ts';
import { normalizeBaseUrl } from './url.ts';
import type { EndpointEntry, ProvidersFile } from './providers-schema.ts';

const LLM_CALL_RETENTION_DAYS = 90;

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

function resolvedFor(state: ProvidersState, purpose: 'narrator' | 'author_chat' | 'background' | 'default') {
  if (state.status !== 'ok') return null;
  const ref = state.file.purposes[purpose] ?? state.file.purposes.default;
  if (!ref) return null;
  const found = foundModel(state, { endpointId: ref.provider, modelId: ref.model });
  if (!found) return null;
  if (found.endpoint.api !== 'openai-completions') return null;
  if ((purpose === 'narrator' || purpose === 'author_chat') && found.model.tools === false) return null;
  return found;
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
        defaultModel: null,
        defaultModelUsable: false,
      };
    }
    const defaultRef = state.file.purposes.default ?? null;
    const defaultModel = defaultRef ? { endpointId: defaultRef.provider, modelId: defaultRef.model } : null;
    const narrator = resolvedFor(state, 'narrator');
    return {
      status: 'ok',
      revision: state.revision,
      problem: null,
      endpoints: state.file.endpoints.map((endpoint) => endpointView(endpoint, env)),
      defaultModel,
      defaultModelUsable: Boolean(
        narrator &&
        defaultRef &&
        narrator.endpoint.id === defaultRef.provider &&
        narrator.model.id === defaultRef.model,
      ),
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

  const targetFor = (purpose: 'narrator' | 'author_chat' | 'background') => {
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
    };
  };

  const runner = createRunner({
    db: deps.db,
    logger: deps.logger,
    shutdown: deps.shutdown,
    timeouts: options?.timeouts,
    targetFor,
  });
  const tester = createConnectionTester({
    store,
    logger: deps.logger,
    shutdown: deps.shutdown,
    env,
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
        const same =
          endpoint.name === input.name && endpoint.models[0]?.id === input.modelId && originalKey === targetKey;
        if (same) return view(state);
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        const target = file.endpoints.find((candidate) => candidate.id === input.endpointId);
        if (!target) throw appError('endpoint_not_found', 'endpoint not found');
        target.name = input.name;
        if (target.models[0]?.id !== input.modelId) {
          const oldModelId = target.models[0]?.id;
          target.models = [{ id: input.modelId }];
          if (oldModelId) {
            const refs = [
              file.purposes.default,
              file.purposes.narrator,
              file.purposes.author_chat,
              file.purposes.background,
            ];
            for (const ref of refs) {
              if (ref && ref.provider === target.id && ref.model === oldModelId) ref.model = input.modelId;
            }
          }
        }
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
        const found = foundModel(state, input.model);
        if (!found) throw appError('endpoint_not_found', 'endpoint or model not found');
        if (
          state.file.purposes.default?.provider === input.model.endpointId &&
          state.file.purposes.default.model === input.model.modelId
        ) {
          return view(state);
        }
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        file.purposes.default = { provider: input.model.endpointId, model: input.model.modelId };
        return view(writeConfig(file));
      });
    },
    testConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
      return tester(input);
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
      const cutoff = Date.now() - LLM_CALL_RETENTION_DAYS * 86_400_000;
      const result = deps.db.run(sql`delete from llm_calls where created_at < ${cutoff}`);
      return Number(result.changes ?? 0);
    },
  };
}
