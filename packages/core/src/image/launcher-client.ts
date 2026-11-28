import {
  LauncherFailureReasonSchema,
  LauncherStateSchema,
  type LauncherFailureReason,
  type LauncherState,
} from '@unwritten/contracts';
import { createNetFetch, RedirectBlockedError } from '../net/fetch.ts';
import { ImageError } from './errors.ts';

export const LAUNCHER_PROTOCOL = 'unwritten-launcher/1';

const LAUNCHER_REQUEST_TIMEOUT_MS = 10_000;

export interface LauncherInfo {
  implementation: { name: string; version: string };
  ready: boolean;
  notReadyReason: string | null;
}

export interface LauncherSnapshot {
  state: LauncherState;
  reason: LauncherFailureReason | null;
  action: { url: string; expiresAt: number } | null;
  since: number;
}

export interface LauncherClient {
  info(signal: AbortSignal): Promise<LauncherInfo>;
  state(signal: AbortSignal): Promise<LauncherSnapshot>;
  start(input: { idempotencyKey: string; idleMinutes: number }, signal: AbortSignal): Promise<LauncherSnapshot>;
  continue(input: { idempotencyKey: string }, signal: AbortSignal): Promise<LauncherSnapshot>;
  stop(input: { idempotencyKey: string }, signal: AbortSignal): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnixSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveUnixSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseLauncherState(
  raw: unknown,
): { ok: true; snapshot: LauncherSnapshot } | { ok: false; issue: string } {
  if (!isRecord(raw)) return { ok: false, issue: 'state is not an object' };
  const state = LauncherStateSchema.safeParse(raw.state);
  if (!state.success) return { ok: false, issue: 'state is not a launcher state' };
  const reason = raw.reason === null ? null : LauncherFailureReasonSchema.safeParse(raw.reason);
  if (reason !== null && !reason.success) return { ok: false, issue: 'reason is not a launcher failure reason' };
  if (!isUnixSeconds(raw.since)) return { ok: false, issue: 'since is not Unix seconds' };
  let action: LauncherSnapshot['action'] = null;
  if (raw.action !== null) {
    if (!isRecord(raw.action)) return { ok: false, issue: 'action is not an object' };
    if (!isHttpsUrl(raw.action.url)) return { ok: false, issue: 'action.url is not https' };
    if (!isPositiveUnixSeconds(raw.action.expiresAt))
      return { ok: false, issue: 'action.expiresAt is not Unix seconds' };
    action = { url: raw.action.url, expiresAt: raw.action.expiresAt * 1000 };
  }
  return {
    ok: true,
    snapshot: {
      state: state.data,
      reason: reason === null ? null : reason.data,
      action,
      since: raw.since * 1000,
    },
  };
}

function parseLauncherInfo(raw: unknown): LauncherInfo | null {
  if (!isRecord(raw) || raw.protocol !== LAUNCHER_PROTOCOL) return null;
  if (!isRecord(raw.implementation)) return null;
  const { name, version } = raw.implementation;
  if (typeof name !== 'string' || typeof version !== 'string') return null;
  if (typeof raw.ready !== 'boolean') return null;
  if (raw.notReadyReason !== null && typeof raw.notReadyReason !== 'string') return null;
  return { implementation: { name, version }, ready: raw.ready, notReadyReason: raw.notReadyReason };
}

function errorCodeOf(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || !isRecord(parsed.error)) return null;
    return typeof parsed.error.code === 'string' ? parsed.error.code : null;
  } catch {
    return null;
  }
}

export function createLauncherClient(options: {
  baseUrl: string;
  token: string | undefined;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}): LauncherClient {
  const fetchImpl = options.fetch ?? createNetFetch();
  const timeoutMs = options.requestTimeoutMs ?? LAUNCHER_REQUEST_TIMEOUT_MS;
  const baseUrl = options.baseUrl.replace(/\/+$/u, '');

  async function request(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
    signal: AbortSignal,
  ): Promise<unknown> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    let response: Response;
    let text: string;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method,
        headers: {
          ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: combined,
      });
      text = await response.text();
    } catch (error) {
      if (error instanceof RedirectBlockedError) {
        throw new ImageError('image_redirected', 'final', { cause: error });
      }
      if (signal.aborted) throw error;
      throw new ImageError('image_launcher_offline', 'transport', { cause: error });
    }
    if (response.status === 401) throw new ImageError('image_launcher_unauthorized', 'final');
    if (!response.ok) {
      const code = errorCodeOf(text);
      if (response.status === 409 && code === 'invalid_state') {
        throw new ImageError('image_wake_failed', 'final', { cause: 'invalid_state' });
      }
      throw new ImageError('image_wake_failed', 'final', { cause: code ?? `http_${response.status}` });
    }
    if (text === '') return null;
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new ImageError('image_wake_failed', 'final', { cause: error });
    }
  }

  function snapshotOf(raw: unknown): LauncherSnapshot {
    const parsed = parseLauncherState(raw);
    if (!parsed.ok) throw new ImageError('image_wake_failed', 'final', { cause: parsed.issue });
    return parsed.snapshot;
  }

  return {
    async info(signal) {
      const info = parseLauncherInfo(await request('/v1/info', { method: 'GET' }, signal));
      if (info === null) throw new ImageError('image_wake_failed', 'final');
      return info;
    },
    async state(signal) {
      return snapshotOf(await request('/v1/state', { method: 'GET' }, signal));
    },
    async start(input, signal) {
      return snapshotOf(await request('/v1/start', { method: 'POST', body: input }, signal));
    },
    async continue(input, signal) {
      return snapshotOf(await request('/v1/continue', { method: 'POST', body: input }, signal));
    },
    async stop(input, signal) {
      await request('/v1/stop', { method: 'POST', body: input }, signal);
    },
  };
}
