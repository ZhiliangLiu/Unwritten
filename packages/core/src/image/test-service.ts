import type { TestImageServiceInput, TestImageServiceResult } from '@unwritten/contracts';
import { resolveApiKey } from '../providers/keys.ts';
import type { ProvidersStore } from '../providers/file.ts';
import type { ImageServiceEntry } from '../providers/schema.ts';
import { PAID_TEST_PROMPT, type ImageEngine } from './engine.ts';
import { ImageError } from './errors.ts';
import { createLauncherClient } from './launcher-client.ts';
import { openAiCapabilities, prefillOpenAiOptions } from './openai-capabilities.ts';
import { createOpenAiImageClient } from './openai-client.ts';
import type { Prober } from './probe.ts';

export interface ServiceTesterDeps {
  store: ProvidersStore;
  prober: Prober;
  engine: ImageEngine;
  shutdown: AbortSignal;
  env: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export type ServiceTester = (input: TestImageServiceInput) => Promise<TestImageServiceResult>;

function emptyResult(partial: Partial<TestImageServiceResult> = {}): TestImageServiceResult {
  return { ok: false, code: null, service: null, launcher: null, generated: null, ...partial };
}

function failure(error: unknown): TestImageServiceResult {
  return emptyResult({ code: error instanceof ImageError ? error.code : 'internal' });
}

export function createServiceTester(deps: ServiceTesterDeps): ServiceTester {
  const entryOf = (serviceId: string): ImageServiceEntry | null => {
    const state = deps.store.load();
    if (state.status !== 'ok') return null;
    return state.file.imageServices.find((entry) => entry.id === serviceId) ?? null;
  };

  const testLauncher = async (entry: ImageServiceEntry): Promise<TestImageServiceResult> => {
    if (entry.launcher === undefined) return failure(new ImageError('image_launcher_offline', 'final'));
    try {
      const client = createLauncherClient({
        baseUrl: entry.launcher.baseUrl,
        token: resolveApiKey(entry.launcher.apiKey, deps.env),
        fetch: deps.fetch,
      });
      const info = await client.info(deps.shutdown);
      const snapshot = await client.state(deps.shutdown);
      return emptyResult({
        ok: true,
        launcher: {
          implementation: info.implementation,
          ready: info.ready,
          notReadyReason: info.notReadyReason,
          state: snapshot.state,
        },
      });
    } catch (error) {
      return failure(error);
    }
  };

  const testOpenAi = async (
    entry: ImageServiceEntry,
    input: TestImageServiceInput,
  ): Promise<TestImageServiceResult> => {
    const options = entry.capabilities ?? prefillOpenAiOptions(entry.model ?? '');
    const service = {
      implementation: null,
      model: entry.model ?? null,
      ready: true,
      notReadyReason: null,
      capabilities: openAiCapabilities(options),
    };
    try {
      if (!input.paid) {
        const client = createOpenAiImageClient({
          baseUrl: entry.baseUrl,
          apiKey: resolveApiKey(entry.apiKey, deps.env),
          model: entry.model ?? '',
          fetch: deps.fetch,
        });
        await client.listModels(deps.shutdown);
        return emptyResult({ ok: true, service });
      }
      const generated = await deps.engine.generate({
        serviceId: entry.id,
        prompt: PAID_TEST_PROMPT,
        negativePrompt: null,
        references: [],
        aspect: '1:1',
        size: null,
        quality: 'fast',
        seed: null,
        signal: deps.shutdown,
        ref: { workId: null, kind: 'test', id: null },
        manual: true,
      });
      return emptyResult({ ok: true, service, generated: { width: generated.width, height: generated.height } });
    } catch (error) {
      return failure(error);
    }
  };

  const testUnwritten = async (entry: ImageServiceEntry): Promise<TestImageServiceResult> => {
    try {
      const outcome = await deps.prober.probe(entry, deps.shutdown);
      if (outcome === null) return failure(new ImageError('image_invalid_response', 'final'));
      const service = {
        implementation: outcome.record.implementation,
        model: outcome.record.model,
        ready: outcome.record.result === 'ready',
        notReadyReason: outcome.record.notReadyReason,
        capabilities: outcome.record.capabilities,
      };
      if (outcome.record.result !== 'ready') {
        return emptyResult({ code: outcome.error?.code ?? 'image_not_ready', service });
      }
      return emptyResult({ ok: true, service });
    } catch (error) {
      return failure(error);
    }
  };

  return async (input) => {
    const entry = entryOf(input.serviceId);
    if (entry === null) return failure(new ImageError('image_not_configured', 'final'));
    if (input.target === 'launcher') return testLauncher(entry);
    if (entry.protocol === 'openai-images') return testOpenAi(entry, input);
    return testUnwritten(entry);
  };
}
