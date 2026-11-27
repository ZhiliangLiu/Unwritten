import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_CORE_PORT, resolveDataDir, resolveDesktopPaths, windowUrl } from './paths.ts';

describe('resolveDesktopPaths', () => {
  it('打包后从资源目录启动 core', () => {
    const paths = resolveDesktopPaths({
      isPackaged: true,
      resourcesPath: '/r',
      appDir: '/app/apps/desktop/dist',
      env: {},
      dataDir: '/data',
    });

    expect(paths.mode).toBe('packaged');
    expect(paths.coreEntry).toBe('/r/core/dist/main.js');
    expect(paths.clientDir).toBe('/r/client');
    expect(paths.port).toBe(0);
    expect(paths.clientOrigin).toBeNull();
    expect(paths.dataDir).toBe('/data');
  });

  it('开发模式跑 core 源码并监听 4317', () => {
    const paths = resolveDesktopPaths({
      isPackaged: false,
      resourcesPath: '/ignored',
      appDir: '/repo/apps/desktop/dist',
      env: { UNWRITTEN_DEV_CLIENT_ORIGIN: 'http://localhost:5173' },
      dataDir: '/data',
    });

    expect(paths.mode).toBe('dev');
    expect(paths.port).toBe(4317);
    expect(paths.port).toBe(DEV_CORE_PORT);
    expect(paths.coreEntry.endsWith('packages/core/src/main.ts')).toBe(true);
    expect(paths.clientDir).toBe(path.join('/repo', 'apps', 'client', 'dist'));
    expect(paths.clientOrigin).toBe('http://localhost:5173');
  });

  it('开发源只接受回环 http', () => {
    const input = {
      isPackaged: false,
      resourcesPath: '/ignored',
      appDir: '/repo/apps/desktop/dist',
      dataDir: '/data',
    };

    expect(() =>
      resolveDesktopPaths({ ...input, env: { UNWRITTEN_DEV_CLIENT_ORIGIN: 'http://example.com:5173' } }),
    ).toThrow();
    expect(() =>
      resolveDesktopPaths({ ...input, env: { UNWRITTEN_DEV_CLIENT_ORIGIN: 'http://localhost:5173' } }),
    ).not.toThrow();
  });

  it('UNWRITTEN_USER_DATA_DIR 覆盖数据目录并解析成绝对路径', () => {
    expect(
      resolveDataDir({
        env: { UNWRITTEN_USER_DATA_DIR: '../../.data' },
        userDataPath: '/Users/someone/Library/Application Support/Unwritten',
        cwd: '/repo/apps/desktop',
      }),
    ).toBe('/repo/.data');
    expect(
      resolveDataDir({
        env: {},
        userDataPath: '/Users/someone/Library/Application Support/Unwritten',
        cwd: '/repo/apps/desktop',
      }),
    ).toBe('/Users/someone/Library/Application Support/Unwritten');
  });

  it('窗口地址的令牌只在 hash 里', () => {
    const paths = resolveDesktopPaths({
      isPackaged: true,
      resourcesPath: '/r',
      appDir: '/app/apps/desktop/dist',
      env: {},
      dataDir: '/data',
    });

    const url = new URL(windowUrl(paths, 4317, 'secret-token'));

    expect(url.search).toBe('');
    expect(url.hash).toBe('#token=secret-token');
    expect(url.origin).toBe('http://127.0.0.1:4317');
  });
});
