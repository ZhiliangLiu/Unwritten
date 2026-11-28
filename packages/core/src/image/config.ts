import type {
  CreateImageServiceInput,
  ErrorCode,
  ImageCapabilities,
  ImageServiceState,
  ImageServiceView,
  LauncherFailureReason,
  UpdateImageServiceInput,
} from '@unwritten/contracts';
import { IMAGE_IDLE_MINUTES } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import { normalizeBaseUrl } from '../net/url.ts';
import { newImageServiceId } from '../providers/ids.ts';
import { keyStatus } from '../providers/keys.ts';
import type { ImageServiceEntry } from '../providers/schema.ts';
import type { ProbeRecord } from './capability-cache.ts';
import { openAiCapabilities, prefillOpenAiOptions } from './openai-capabilities.ts';

export interface ImageWakeView {
  state: ImageServiceState;
  action: { url: string; expiresAt: number } | null;
  wakeFailure: { code: ErrorCode; reason: LauncherFailureReason | null } | null;
}

export const UNKNOWN_WAKE_VIEW: ImageWakeView = { state: 'unknown', action: null, wakeFailure: null };

export function validateBaseUrl(raw: string): string {
  const baseUrl = normalizeBaseUrl(raw);
  if (!baseUrl) throw appError('invalid_url', 'invalid endpoint url');
  return baseUrl;
}

function openAiOptions(entry: ImageServiceEntry): { maxReferences: number; sizes: 'fixed' | 'custom' } {
  return entry.capabilities ?? prefillOpenAiOptions(entry.model ?? '');
}

export function serviceView(
  entry: ImageServiceEntry,
  env: NodeJS.ProcessEnv,
  probe: ProbeRecord | null,
  wake: ImageWakeView,
  lastSuccessAt: number | null,
): ImageServiceView {
  const capabilities: ImageCapabilities | null =
    entry.protocol === 'openai-images' ? openAiCapabilities(openAiOptions(entry)) : (probe?.capabilities ?? null);
  return {
    id: entry.id,
    name: entry.name,
    protocol: entry.protocol,
    baseUrl: entry.baseUrl,
    key: keyStatus(entry.apiKey, env),
    model: entry.model ?? null,
    openai: entry.protocol === 'openai-images' ? openAiOptions(entry) : null,
    launcher: entry.launcher ? { baseUrl: entry.launcher.baseUrl, key: keyStatus(entry.launcher.apiKey, env) } : null,
    idleMinutes: entry.idleMinutes ?? IMAGE_IDLE_MINUTES,
    capabilities,
    probe: probe
      ? {
          at: probe.at,
          result: probe.result,
          notReadyReason: probe.notReadyReason,
          implementation: probe.implementation,
          model: probe.model,
        }
      : null,
    lastSuccessAt,
    state: wake.state,
    action: wake.action,
    wakeFailure: wake.wakeFailure,
  };
}

function requireModel(input: CreateImageServiceInput | UpdateImageServiceInput): string {
  if (!input.model) throw appError('invalid_input', 'model is required for openai-images');
  return input.model;
}

export function createEntry(input: CreateImageServiceInput): ImageServiceEntry {
  const entry: ImageServiceEntry = {
    id: newImageServiceId(input.name, input.requestId),
    name: input.name,
    protocol: input.protocol,
    baseUrl: validateBaseUrl(input.baseUrl),
  };
  if (input.apiKey !== null) entry.apiKey = input.apiKey;
  if (input.protocol === 'openai-images') {
    if (input.launcher !== null) throw appError('invalid_input', 'launcher is only available for unwritten-image');
    const model = requireModel(input);
    entry.model = model;
    entry.capabilities = input.openai ?? prefillOpenAiOptions(model);
  } else if (input.launcher !== null) {
    entry.launcher = { baseUrl: validateBaseUrl(input.launcher.baseUrl) };
    if (input.launcher.apiKey !== null) entry.launcher.apiKey = input.launcher.apiKey;
    entry.idleMinutes = input.idleMinutes ?? IMAGE_IDLE_MINUTES;
  }
  return entry;
}

function applyKeyChange(
  target: { apiKey?: string },
  change: { action: 'keep' } | { action: 'set'; value: string } | { action: 'remove' },
): void {
  if (change.action === 'keep') return;
  if (change.action === 'set') target.apiKey = change.value;
  else delete target.apiKey;
}

export function applyUpdate(entry: ImageServiceEntry, input: UpdateImageServiceInput): ImageServiceEntry {
  const next: ImageServiceEntry = { ...entry, name: input.name };
  applyKeyChange(next, input.key);
  if (entry.protocol === 'openai-images') {
    const model = requireModel(input);
    const keepCapabilities = input.openai === null && entry.model === model && entry.capabilities !== undefined;
    next.model = model;
    next.capabilities = input.openai ?? (keepCapabilities ? entry.capabilities : prefillOpenAiOptions(model));
    if (input.launcher.action !== 'keep') {
      throw appError('invalid_input', 'launcher is only available for unwritten-image');
    }
    delete next.launcher;
    delete next.idleMinutes;
  } else {
    delete next.model;
    delete next.capabilities;
    if (input.launcher.action === 'set') {
      const baseUrl = validateBaseUrl(input.launcher.baseUrl);
      if (entry.launcher && entry.launcher.baseUrl !== baseUrl) {
        throw appError('invalid_input', 'launcher address cannot change');
      }
      const launcher: NonNullable<ImageServiceEntry['launcher']> = { baseUrl };
      if (input.launcher.apiKey !== null) launcher.apiKey = input.launcher.apiKey;
      next.launcher = launcher;
      next.idleMinutes = input.idleMinutes;
    } else if (input.launcher.action === 'remove') {
      delete next.launcher;
      delete next.idleMinutes;
    } else if (entry.launcher) {
      const launcher = { ...entry.launcher };
      applyKeyChange(launcher, input.launcher.key);
      next.launcher = launcher;
      next.idleMinutes = input.idleMinutes;
    }
  }
  return next;
}
