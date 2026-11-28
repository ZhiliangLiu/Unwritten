import { join } from 'node:path';
import type {
  CreateImageServiceInput,
  CreateImageServiceOutput,
  ImageCapabilities,
  ImageConfigView,
  OutputOptionsView,
  RemoveImageServiceInput,
  SelectImageServiceInput,
  SetAutoIllustrationInput,
  UpdateImageServiceInput,
} from '@unwritten/contracts';
import { appError } from '../errors.ts';
import { diagnosticFault } from '../log/fault.ts';
import type { CoreDeps, ImageService, LlmService } from '../services.ts';
import { createProvidersStore, type ProvidersState } from '../providers/file.ts';
import type { ProvidersFile } from '../providers/schema.ts';
import { lastSuccessAt, pruneCalls, usageSummary as readUsageSummary } from './calls.ts';
import { createCapabilityCache, type ProbeRecord } from './capability-cache.ts';
import { createKnownCapabilitiesStore, type KnownCapabilities } from './known-capabilities.ts';
import { applyUpdate, createEntry, serviceView, UNKNOWN_WAKE_VIEW, type ImageWakeView } from './config.ts';
import { createImageEngine } from './engine.ts';
import { ImageError } from './errors.ts';
import { createProber, type ProbeCache, type Prober } from './probe.ts';
import { createImageQueue } from './queue.ts';
import { createServiceTester } from './test-service.ts';
import { createWaker } from './wake.ts';
import { openAiCapabilities, resolveOpenAiOptions } from './openai-capabilities.ts';
import {
  autoView,
  currentTarget,
  outputOptions,
  readIllustrationSettings,
  setAuto,
  setOutputPreferences,
  writeIllustrationSettings,
} from './settings.ts';
import { generateServiceToken } from './token.ts';

function imageConfigKey(state: ProvidersState): string {
  if (state.status !== 'ok') return state.status;
  return `${JSON.stringify(state.file.imageServices)}${JSON.stringify(state.file.image)}`;
}

function probeWakeView(probe: ProbeRecord | null): ImageWakeView {
  if (probe?.result === 'ready') return { state: 'ready', action: null, wakeFailure: null };
  if (probe?.result === 'offline') return { state: 'offline', action: null, wakeFailure: null };
  return UNKNOWN_WAKE_VIEW;
}

export interface ImageRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollIntervalMs?: number;
  jobTimeoutMs?: number;
  offlineTtlMs?: number;
  wakePollMs?: number;
  wakeTimeoutMs?: number;
}

export function createImageService(deps: CoreDeps & { llm: LlmService }, options?: ImageRuntimeOptions): ImageService {
  const env = options?.env ?? process.env;
  const now = options?.now ?? Date.now;
  const store = deps.providers ?? createProvidersStore(join(deps.dataDir, 'providers.json'));
  const memoryCache = createCapabilityCache();
  const known = createKnownCapabilitiesStore(deps.db);
  const storeKnown = (op: 'save' | 'remove', serviceId: string, write: () => void): void => {
    try {
      write();
    } catch (error) {
      deps.logger.record({
        level: 'warn',
        module: 'image',
        event: 'image.capabilities.store_failed',
        data: { op, serviceId, ...diagnosticFault(error) },
      });
    }
  };
  const cache: ProbeCache = {
    get: (serviceId) => memoryCache.get(serviceId),
    set(serviceId, record) {
      memoryCache.set(serviceId, record);
      const capabilities = record.capabilities;
      if (capabilities === null) return;
      storeKnown('save', serviceId, () => known.save(serviceId, { capabilities, at: record.at }));
    },
    delete(serviceId) {
      memoryCache.delete(serviceId);
      storeKnown('remove', serviceId, () => known.remove(serviceId));
    },
  };
  const queue = createImageQueue();
  const rawProber = createProber({
    cache,
    logger: deps.logger,
    shutdown: deps.shutdown,
    env,
    fetch: options?.fetch,
    now,
  });
  const waker = createWaker({
    store,
    logger: deps.logger,
    bus: deps.bus,
    shutdown: deps.shutdown,
    env,
    probe: (entry, signal) => rawProber.probe(entry, signal),
    fetch: options?.fetch,
    pollMs: options?.wakePollMs,
    timeoutMs: options?.wakeTimeoutMs,
    now,
    sleep: options?.sleep,
  });
  const prober: Prober = {
    async probe(entry, signal) {
      const outcome = await rawProber.probe(entry, signal);
      if (outcome?.record.result === 'ready') waker.markReady(entry.id);
      return outcome;
    },
    offlineSince(serviceId) {
      return rawProber.offlineSince(serviceId);
    },
  };
  const engine = createImageEngine({
    store,
    cache,
    queue,
    prober,
    waker,
    db: deps.db,
    logger: deps.logger,
    shutdown: deps.shutdown,
    env,
    fetch: options?.fetch,
    now,
    sleep: options?.sleep,
    pollIntervalMs: options?.pollIntervalMs,
    jobTimeoutMs: options?.jobTimeoutMs,
    offlineTtlMs: options?.offlineTtlMs,
  });
  const tester = createServiceTester({
    store,
    prober,
    engine,
    shutdown: deps.shutdown,
    env,
    fetch: options?.fetch,
  });
  let previousImageConfig: string | null = null;
  let initialized = false;

  const observeConfig = (state: ProvidersState, initial: boolean): void => {
    const current = imageConfigKey(state);
    const changed = !initial && previousImageConfig !== null && previousImageConfig !== current;
    previousImageConfig = current;
    deps.logger.record({
      level: 'info',
      module: 'image',
      event: 'image.config.loaded',
      data: {
        services: state.status === 'ok' ? state.file.imageServices.length : 0,
        selected: state.status === 'ok' && state.file.image.service !== null,
      },
    });
    if (changed) deps.bus.publish({ type: 'image.config_changed' });
  };

  store.subscribe((state) => {
    observeConfig(state, !initialized);
    initialized = true;
  });

  const initial = store.load();
  if (!initialized) {
    observeConfig(initial, true);
    initialized = true;
  }

  function ensureWritable(
    state: ProvidersState,
  ): asserts state is Extract<ProvidersState, { status: 'ok' | 'missing' }> {
    if (state.status === 'invalid') throw appError('llm_config_invalid', 'providers.json is invalid');
    if (state.status === 'too_new') throw appError('llm_config_too_new', 'providers.json is too new');
  }

  const view = (state: ProvidersState): ImageConfigView => {
    if (state.status !== 'ok') {
      return {
        status: state.status,
        revision: state.revision,
        problem: state.status === 'missing' ? null : state.problem,
        services: [],
        selectedServiceId: null,
      };
    }
    const successes = lastSuccessAt(deps.db);
    const services = state.file.imageServices.map((entry) => {
      const probe = cache.get(entry.id);
      const wake = entry.launcher === undefined ? probeWakeView(probe) : waker.stateOf(entry.id);
      return serviceView(entry, env, probe, lastKnown(entry.id), wake, successes.get(entry.id) ?? null);
    });
    const selected = state.file.image.service;
    return {
      status: 'ok',
      revision: state.revision,
      problem: null,
      services,
      selectedServiceId: selected !== null && services.some((service) => service.id === selected) ? selected : null,
    };
  };

  const writeConfig = (file: ProvidersFile): ProvidersState => store.write(file);

  function lastKnown(serviceId: string): KnownCapabilities | null {
    const probe = cache.get(serviceId);
    return probe?.capabilities ? { capabilities: probe.capabilities, at: probe.at } : known.get(serviceId);
  }

  const capabilities = (serviceId: string): ImageCapabilities | null => {
    const state = store.load();
    if (state.status !== 'ok') return null;
    const entry = state.file.imageServices.find((candidate) => candidate.id === serviceId);
    if (!entry) return null;
    if (entry.protocol === 'openai-images') {
      return openAiCapabilities(resolveOpenAiOptions(entry.capabilities, entry.model ?? ''));
    }
    return cache.get(entry.id)?.capabilities ?? null;
  };

  const settingsCapabilities = (serviceId: string): ImageCapabilities | null => {
    const state = store.load();
    if (state.status !== 'ok') return null;
    const entry = state.file.imageServices.find((candidate) => candidate.id === serviceId);
    if (!entry) return null;
    if (entry.protocol === 'openai-images') return capabilities(serviceId);
    return lastKnown(serviceId)?.capabilities ?? null;
  };

  const selectedServiceId = (): string | null => {
    const state = store.load();
    if (state.status !== 'ok') return null;
    const selected = state.file.image.service;
    if (selected === null) return null;
    return state.file.imageServices.some((entry) => entry.id === selected) ? selected : null;
  };

  const output = (): OutputOptionsView => {
    const settings = readIllustrationSettings(deps.db, deps.logger);
    const selected = selectedServiceId();
    return outputOptions(settings, selected === null ? null : settingsCapabilities(selected));
  };

  return {
    listServices() {
      return view(store.load());
    },
    async createService(input: CreateImageServiceInput): Promise<CreateImageServiceOutput> {
      const entry = createEntry(input);
      return store.enqueue(() => {
        const state = store.load();
        ensureWritable(state);
        const existing = state.file.imageServices.find((candidate) => candidate.id === entry.id);
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(entry)) {
            throw appError('idempotency_conflict', 'image service id is already used');
          }
          return { serviceId: entry.id, config: view(state) };
        }
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        if (file.imageServices.length === 0) file.image.service = entry.id;
        file.imageServices.push(entry);
        const next = writeConfig(file);
        deps.logger.record({
          level: 'info',
          module: 'image',
          event: 'image.service.created',
          data: { protocol: entry.protocol, hasLauncher: Boolean(entry.launcher) },
        });
        return { serviceId: entry.id, config: view(next) };
      });
    },
    async updateService(input: UpdateImageServiceInput): Promise<ImageConfigView> {
      return store.enqueue(() => {
        const state = store.load();
        ensureWritable(state);
        const entry = state.file.imageServices.find((candidate) => candidate.id === input.serviceId);
        if (!entry) throw appError('endpoint_not_found', 'image service not found');
        const updated = applyUpdate(entry, input);
        if (JSON.stringify(updated) === JSON.stringify(entry)) return view(state);
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        const index = file.imageServices.findIndex((candidate) => candidate.id === input.serviceId);
        file.imageServices[index] = updated;
        const next = writeConfig(file);
        deps.logger.record({
          level: 'info',
          module: 'image',
          event: 'image.service.updated',
          data: { protocol: updated.protocol, hasLauncher: Boolean(updated.launcher) },
        });
        return view(next);
      });
    },
    async removeService(input: RemoveImageServiceInput): Promise<ImageConfigView> {
      return store.enqueue(() => {
        const state = store.load();
        ensureWritable(state);
        const removed = state.file.imageServices.find((entry) => entry.id === input.serviceId);
        if (!removed) return view(state);
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        file.imageServices = file.imageServices.filter((entry) => entry.id !== input.serviceId);
        if (file.image.service === input.serviceId) file.image.service = null;
        const next = writeConfig(file);
        cache.delete(input.serviceId);
        deps.logger.record({
          level: 'info',
          module: 'image',
          event: 'image.service.removed',
          data: { protocol: removed.protocol, hasLauncher: Boolean(removed.launcher) },
        });
        return view(next);
      });
    },
    generateToken() {
      return { token: generateServiceToken() };
    },
    testService(input) {
      return tester(input);
    },
    async select(input: SelectImageServiceInput): Promise<ImageConfigView> {
      return store.enqueue(() => {
        const state = store.load();
        ensureWritable(state);
        if (input.serviceId !== null && !state.file.imageServices.some((entry) => entry.id === input.serviceId)) {
          throw appError('endpoint_not_found', 'image service not found');
        }
        if (state.file.image.service === input.serviceId) return view(state);
        if (state.revision !== input.baseRevision) throw appError('config_conflict', 'providers.json changed');
        const file = structuredClone(state.file);
        file.image.service = input.serviceId;
        return view(writeConfig(file));
      });
    },
    getOutputOptions() {
      return output();
    },
    setOutputPreferences(input) {
      const settings = readIllustrationSettings(deps.db, deps.logger);
      const next = writeIllustrationSettings(deps.db, setOutputPreferences(settings, input));
      deps.bus.publish({ type: 'image.config_changed' });
      const selected = selectedServiceId();
      return outputOptions(next, selected === null ? null : settingsCapabilities(selected));
    },
    getAutoIllustration() {
      const settings = readIllustrationSettings(deps.db, deps.logger);
      return autoView(settings, currentTarget(store.load(), deps.llm));
    },
    setAutoIllustration(input: SetAutoIllustrationInput) {
      const settings = readIllustrationSettings(deps.db, deps.logger);
      const current = currentTarget(store.load(), deps.llm);
      const next = writeIllustrationSettings(deps.db, setAuto(settings, input, current));
      deps.logger.record({
        level: 'info',
        module: 'image',
        event: 'image.auto_illustration.set',
        data: { enabled: next.autoEnabled },
      });
      deps.bus.publish({ type: 'image.config_changed' });
      return autoView(next, current);
    },
    activeTarget() {
      const settings = readIllustrationSettings(deps.db, deps.logger);
      const current = currentTarget(store.load(), deps.llm);
      return autoView(settings, current).enabled ? current : null;
    },
    selectedServiceId,
    capabilities,
    assertFormat(capabilities, format) {
      engine.assertGenerationFormat(capabilities, format);
    },
    generate(input) {
      return engine.generate(input);
    },
    prepareGeneration(serviceId, input) {
      return engine.prepareGeneration(serviceId, input);
    },
    wake(serviceId, trigger) {
      engine.wake(serviceId, trigger);
    },
    async continueWake(input) {
      try {
        await waker.continueWake(input.serviceId, input.requestId);
      } catch (error) {
        if (error instanceof ImageError) throw appError(error.code, error.code);
        throw error;
      }
      return {};
    },
    usageSummary() {
      const state = store.load();
      const entries = state.status === 'ok' ? state.file.imageServices.map(({ id, name }) => ({ id, name })) : [];
      return readUsageSummary(deps.db, entries, now());
    },
    pruneCalls() {
      return pruneCalls(deps.db, now());
    },
    whenIdle() {
      return engine.whenIdle();
    },
  };
}
