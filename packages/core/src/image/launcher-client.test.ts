import { describe, expect, it } from 'vitest';
import type { LauncherState } from '@unwritten/contracts';
import { startFakeLauncher, type FakeLauncher } from '../test-support/fake-launcher.ts';
import { createLauncherClient, type LauncherClient, type LauncherSnapshot } from './launcher-client.ts';

const SIGNAL_TIMEOUT_MS = 5_000;
const STATE_WAIT_MS = 2_000;

function clientFor(launcher: FakeLauncher, token?: string): LauncherClient {
  return createLauncherClient({ baseUrl: launcher.url, token: token ?? launcher.token });
}

async function waitForState(
  client: LauncherClient,
  state: LauncherState,
  timeoutMs: number,
): Promise<LauncherSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await client.state(AbortSignal.timeout(SIGNAL_TIMEOUT_MS));
    if (snapshot.state === state) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`launcher did not reach ${state}`);
}

describe('createLauncherClient', () => {
  it('把 since 和 expiresAt 从 Unix 秒换算成毫秒', async () => {
    const launcher = await startFakeLauncher();
    try {
      launcher.setState('failed', {
        reason: 'quota',
        action: { url: 'https://accounts.example.test/consent', expiresAt: 1_900_000_000 },
      });
      const snapshot = await clientFor(launcher).state(AbortSignal.timeout(SIGNAL_TIMEOUT_MS));
      expect(snapshot).toMatchObject({ state: 'failed', reason: 'quota' });
      expect(snapshot.since % 1000).toBe(0);
      expect(Math.abs(snapshot.since - Date.now())).toBeLessThan(5_000);
      expect(snapshot.action?.expiresAt).toBe(1_900_000_000_000);
    } finally {
      await launcher.close();
    }
  });

  it('action.url 不是 https 时抛 image_wake_failed', async () => {
    const launcher = await startFakeLauncher();
    try {
      const client = clientFor(launcher);
      launcher.setState('needs_action', {
        action: { url: 'https://accounts.example.test/consent', expiresAt: Math.floor(Date.now() / 1000) + 600 },
      });
      await expect(client.state(AbortSignal.timeout(SIGNAL_TIMEOUT_MS))).resolves.toMatchObject({
        state: 'needs_action',
        action: { url: 'https://accounts.example.test/consent' },
      });
      launcher.setState('needs_action', {
        action: { url: 'http://accounts.example.test/consent', expiresAt: Math.floor(Date.now() / 1000) + 600 },
      });
      await expect(client.state(AbortSignal.timeout(SIGNAL_TIMEOUT_MS))).rejects.toMatchObject({
        code: 'image_wake_failed',
      });
    } finally {
      await launcher.close();
    }
  });

  it('401 映射成 image_launcher_unauthorized', async () => {
    const launcher = await startFakeLauncher();
    try {
      await expect(
        clientFor(launcher, 'wrong-token-0123456789abcdef0123456789abcdef').info(
          AbortSignal.timeout(SIGNAL_TIMEOUT_MS),
        ),
      ).rejects.toMatchObject({ code: 'image_launcher_unauthorized' });
      await expect(clientFor(launcher).info(AbortSignal.timeout(SIGNAL_TIMEOUT_MS))).resolves.toMatchObject({
        ready: true,
        implementation: { name: 'Fake', version: '0.0.0' },
      });
    } finally {
      await launcher.close();
    }
  });

  it('连接被拒映射成 image_launcher_offline', async () => {
    const launcher = await startFakeLauncher();
    const client = clientFor(launcher);
    try {
      await expect(client.info(AbortSignal.timeout(SIGNAL_TIMEOUT_MS))).resolves.toMatchObject({ ready: true });
    } finally {
      await launcher.close();
    }
    await expect(client.info(AbortSignal.timeout(SIGNAL_TIMEOUT_MS))).rejects.toMatchObject({
      code: 'image_launcher_offline',
    });
  });

  it('continue 在错误状态下抛 image_wake_failed，cause 是 invalid_state', async () => {
    const launcher = await startFakeLauncher();
    try {
      const client = clientFor(launcher);
      await expect(
        client.continue({ idempotencyKey: 'before-start' }, AbortSignal.timeout(SIGNAL_TIMEOUT_MS)),
      ).rejects.toMatchObject({
        code: 'image_wake_failed',
        cause: 'invalid_state',
      });
      await client.start({ idempotencyKey: 'start', idleMinutes: 30 }, AbortSignal.timeout(SIGNAL_TIMEOUT_MS));
      await waitForState(client, 'needs_action', STATE_WAIT_MS);
      await expect(
        client.continue({ idempotencyKey: 'after-action' }, AbortSignal.timeout(SIGNAL_TIMEOUT_MS)),
      ).resolves.toMatchObject({ state: 'starting' });
    } finally {
      await launcher.close();
    }
  });
});
