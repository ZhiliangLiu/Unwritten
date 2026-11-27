import { describe, expect, it, vi } from 'vitest';
import { resolveShellEnv } from './shell-env.ts';

describe('resolveShellEnv', () => {
  it('读到的变量覆盖启动时的环境', async () => {
    const result = await resolveShellEnv({
      platform: 'darwin',
      base: { PATH: '/usr/bin', HOME: '/Users/someone' },
      read: () => Promise.resolve({ PATH: '/opt/homebrew/bin', API_KEY: 'secret' }),
    });

    expect(result.env.PATH).toBe('/opt/homebrew/bin');
    expect(result.env.HOME).toBe('/Users/someone');
    expect(result.env.API_KEY).toBe('secret');
    expect(result.ok).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.vars).toBe(2);
  });

  it('超时用启动时的环境并标记超时', async () => {
    const result = await resolveShellEnv({
      platform: 'darwin',
      base: { PATH: '/usr/bin' },
      read: () => new Promise(() => {}),
      timeoutMs: 10,
    });

    expect(result.env).toEqual({ PATH: '/usr/bin' });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.vars).toBe(0);
  });

  it('读取失败不抛错', async () => {
    const result = await resolveShellEnv({
      platform: 'linux',
      base: { PATH: '/usr/bin' },
      read: () => Promise.reject(new Error('shell failed')),
    });

    expect(result.env).toEqual({ PATH: '/usr/bin' });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.vars).toBe(0);
  });

  it('Windows 不读取', async () => {
    const read = vi.fn(() => Promise.resolve({ PATH: '/windows' }));

    const result = await resolveShellEnv({ platform: 'win32', base: { PATH: '/usr/bin' }, read });

    expect(read).toHaveBeenCalledTimes(0);
    expect(result.env).toEqual({ PATH: '/usr/bin' });
    expect(result.ok).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.vars).toBe(0);
  });
});
