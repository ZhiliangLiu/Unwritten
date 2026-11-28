import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LAUNCHER_STATES } from '@unwritten/contracts';
import { startFakeLauncher } from '../../../test-support/fake-launcher.ts';
import { conformanceTarget } from '../../conformance/target.ts';
import { parseLauncherState } from '../../launcher-client.ts';

interface LauncherBody {
  protocol?: string;
  implementation?: { name?: string; version?: string };
  ready?: boolean;
  notReadyReason?: string | null;
  capabilities?: unknown;
  state?: string;
  action?: unknown;
  since?: number;
  error?: { code?: string };
}

interface LauncherStateBody {
  state: string;
  action: unknown;
  since: number;
}

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

let target: Awaited<ReturnType<typeof conformanceTarget>>;
const responses: Response[] = [];

async function call(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; token?: string | null } = {},
): Promise<{ status: number; body: LauncherBody | null }> {
  const method = options.method ?? 'GET';
  const token = options.token === undefined ? target.token : options.token;
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${target.url}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
  });
  responses.push(response);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as LauncherBody) };
}

async function launcherState(): Promise<LauncherBody> {
  const result = await call('/v1/state');
  expect(result.status).toBe(200);
  if (result.body === null) throw new Error('launcher state is empty');
  return result.body;
}

async function waitForLauncherState(states: string[], timeoutMs: number): Promise<LauncherStateBody> {
  return vi.waitFor(
    async () => {
      const body = await launcherState();
      const state = body.state;
      if (typeof state !== 'string' || !states.includes(state)) throw new Error(`launcher state is ${String(state)}`);
      if (typeof body.since !== 'number') throw new Error('launcher since is not a number');
      return { state, action: body.action, since: body.since };
    },
    { timeout: timeoutMs, interval: 50 },
  );
}

beforeAll(async () => {
  target = await conformanceTarget('UNWRITTEN_LAUNCHER', startFakeLauncher);
});

afterAll(async () => {
  await target.close();
});

describe('unwritten-launcher/1 一致性', () => {
  it('不带令牌或带错令牌都返回 401', async () => {
    const missing = await call('/v1/info', { token: null });
    expect(missing.status).toBe(401);
    expect(missing.body?.error?.code).toBe('unauthorized');
    const wrong = await call('/v1/info', { token: 'wrong-token-0123456789abcdef0123456789abcdef' });
    expect(wrong.status).toBe(401);
    expect(wrong.body?.error?.code).toBe('unauthorized');
  });

  it('/v1/info 返回协议名、实现、就绪状态和能力', async () => {
    const { status, body } = await call('/v1/info');
    expect(status).toBe(200);
    expect(body?.protocol).toBe('unwritten-launcher/1');
    expect(typeof body?.implementation?.name).toBe('string');
    expect(typeof body?.implementation?.version).toBe('string');
    expect(typeof body?.ready).toBe('boolean');
    expect(body?.notReadyReason === null || typeof body?.notReadyReason === 'string').toBe(true);
    expect(body?.capabilities).not.toBeNull();
    expect(typeof body?.capabilities).toBe('object');
  });

  it('/v1/state 返回合格的状态 JSON', async () => {
    const body = await launcherState();
    expect(parseLauncherState(body).ok).toBe(true);
    expect(LAUNCHER_STATES).toContain(body.state);
    expect(Number.isInteger(body.since)).toBe(true);
  });

  it('start 的 idleMinutes 小于 5 返回 400 invalid_request', async () => {
    const { status, body } = await call('/v1/start', {
      method: 'POST',
      body: { idempotencyKey: randomUUID(), idleMinutes: 4 },
    });
    expect(status).toBe(400);
    expect(body?.error?.code).toBe('invalid_request');
  });

  it('状态不是 needs_action 时 continue 返回 409 invalid_state', async () => {
    const before = await launcherState();
    if (before.state === 'needs_action') {
      const resumed = await call('/v1/continue', { method: 'POST', body: { idempotencyKey: randomUUID() } });
      expect(resumed.status).toBe(202);
    }
    const { status, body } = await call('/v1/continue', { method: 'POST', body: { idempotencyKey: randomUUID() } });
    expect(status).toBe(409);
    expect(body?.error?.code).toBe('invalid_state');
  });

  it('重复 start 不重新启动', async () => {
    const first = await call('/v1/start', { method: 'POST', body: { idempotencyKey: randomUUID(), idleMinutes: 30 } });
    expect(first.status).toBe(202);
    const before = await waitForLauncherState(['needs_action', 'running'], 120_000);
    const second = await call('/v1/start', { method: 'POST', body: { idempotencyKey: randomUUID(), idleMinutes: 30 } });
    expect(second.status).toBe(202);
    expect(second.body?.state).toBe(before.state);
    if (typeof second.body?.since !== 'number') throw new Error('second start did not return since');
    expect(second.body.since).toBeGreaterThanOrEqual(before.since);
  }, 300_000);

  it('走到 needs_action 后 continue，最终到达 running', async () => {
    const started = await call('/v1/start', {
      method: 'POST',
      body: { idempotencyKey: randomUUID(), idleMinutes: 30 },
    });
    expect(started.status).toBe(202);
    const first = await waitForLauncherState(['needs_action', 'running'], 120_000);
    if (first.state === 'needs_action') {
      const action = first.action as { url?: string; expiresAt?: number } | null;
      expect(action?.url?.startsWith('https://')).toBe(true);
      expect(Number.isInteger(action?.expiresAt)).toBe(true);
      const resumed = await call('/v1/continue', { method: 'POST', body: { idempotencyKey: randomUUID() } });
      expect(resumed.status).toBe(202);
    } else {
      process.stdout.write('launcher skipped needs_action and is already running\n');
    }
    const running = await waitForLauncherState(['running'], 120_000);
    expect(running.state).toBe('running');
  }, 300_000);

  it('stop 返回 202 并到达 stopped', async () => {
    const sent = await call('/v1/stop', { method: 'POST', body: { idempotencyKey: randomUUID() } });
    expect(sent.status).toBe(202);
    const stopped = await waitForLauncherState(['stopped'], 120_000);
    expect(stopped.state).toBe('stopped');
  }, 300_000);

  it('所有响应都不是重定向，也没有 CORS 头', () => {
    expect(responses.length).toBeGreaterThan(0);
    for (const response of responses) {
      expect(REDIRECT_STATUSES).not.toContain(response.status);
      for (const [name] of response.headers) {
        expect(name.startsWith('access-control-')).toBe(false);
      }
    }
  });
});
