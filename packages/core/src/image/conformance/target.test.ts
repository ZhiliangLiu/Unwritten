import { afterEach, describe, expect, it, vi } from 'vitest';
import { conformanceTarget } from './target.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

async function fakeTarget() {
  return {
    url: 'http://127.0.0.1:9999',
    token: 'test-token-0123456789abcdef0123456789abcdef',
    async close() {},
  };
}

describe('conformanceTarget', () => {
  it('两个环境变量都设置时使用真实目标', async () => {
    vi.stubEnv('UNWRITTEN_IMAGE_CONFORMANCE_URL', 'https://image.example.test');
    vi.stubEnv('UNWRITTEN_IMAGE_CONFORMANCE_TOKEN', 'test-token-0123456789abcdef0123456789abcdef');
    const startFake = vi.fn(fakeTarget);
    const target = await conformanceTarget('UNWRITTEN_IMAGE', startFake);
    expect(target).toMatchObject({
      url: 'https://image.example.test',
      token: 'test-token-0123456789abcdef0123456789abcdef',
      real: true,
    });
    expect(startFake).not.toHaveBeenCalled();
    await expect(target.close()).resolves.toBeUndefined();
  });

  it('两个环境变量都没设置时启动伪服务', async () => {
    vi.stubEnv('UNWRITTEN_LAUNCHER_CONFORMANCE_URL', undefined);
    vi.stubEnv('UNWRITTEN_LAUNCHER_CONFORMANCE_TOKEN', undefined);
    const startFake = vi.fn(fakeTarget);
    const target = await conformanceTarget('UNWRITTEN_LAUNCHER', startFake);
    expect(target).toMatchObject({ url: 'http://127.0.0.1:9999', real: false });
    expect(startFake).toHaveBeenCalledTimes(1);
    await target.close();
  });

  it('只设置一个环境变量时抛错', async () => {
    vi.stubEnv('UNWRITTEN_IMAGE_CONFORMANCE_URL', 'https://image.example.test');
    vi.stubEnv('UNWRITTEN_IMAGE_CONFORMANCE_TOKEN', undefined);
    const startFake = vi.fn(fakeTarget);
    await expect(conformanceTarget('UNWRITTEN_IMAGE', startFake)).rejects.toThrow(
      'UNWRITTEN_IMAGE_CONFORMANCE_URL and UNWRITTEN_IMAGE_CONFORMANCE_TOKEN must be set together',
    );
    expect(startFake).not.toHaveBeenCalled();
  });
});
