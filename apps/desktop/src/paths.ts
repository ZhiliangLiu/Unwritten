import path from 'node:path';

export const DEV_CORE_PORT = 4317;
export type DesktopMode = 'packaged' | 'dev' | 'local';

export interface DesktopPaths {
  mode: DesktopMode;
  coreEntry: string;
  clientDir: string;
  port: number;
  clientOrigin: string | null;
  dataDir: string;
}

export function resolveDataDir(input: { env: NodeJS.ProcessEnv; userDataPath: string; cwd: string }): string {
  const override = input.env.UNWRITTEN_USER_DATA_DIR;
  if (override !== undefined && override !== '') return path.resolve(input.cwd, override);
  return input.userDataPath;
}

export function resolveDesktopPaths(input: {
  isPackaged: boolean;
  resourcesPath: string;
  appDir: string;
  env: NodeJS.ProcessEnv;
  dataDir: string;
}): DesktopPaths {
  if (input.isPackaged) {
    return {
      mode: 'packaged',
      coreEntry: path.join(input.resourcesPath, 'core', 'dist', 'main.js'),
      clientDir: path.join(input.resourcesPath, 'client'),
      port: 0,
      clientOrigin: null,
      dataDir: input.dataDir,
    };
  }

  const repo = path.resolve(input.appDir, '..', '..', '..');
  const devOrigin = input.env.UNWRITTEN_DEV_CLIENT_ORIGIN;
  if (devOrigin !== undefined && devOrigin !== '') {
    if (!/^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/.test(devOrigin)) {
      throw new Error('UNWRITTEN_DEV_CLIENT_ORIGIN must be a loopback http origin');
    }
    return {
      mode: 'dev',
      coreEntry: path.join(repo, 'packages', 'core', 'src', 'main.ts'),
      clientDir: path.join(repo, 'apps', 'client', 'dist'),
      port: DEV_CORE_PORT,
      clientOrigin: devOrigin,
      dataDir: input.dataDir,
    };
  }

  return {
    mode: 'local',
    coreEntry: path.join(repo, 'packages', 'core', 'dist', 'main.js'),
    clientDir: path.join(repo, 'apps', 'client', 'dist'),
    port: 0,
    clientOrigin: null,
    dataDir: input.dataDir,
  };
}

export function allowedOrigin(paths: DesktopPaths, port: number): string {
  return paths.clientOrigin ?? `http://127.0.0.1:${port}`;
}

export function windowUrl(paths: DesktopPaths, port: number, token: string): string {
  return `${allowedOrigin(paths, port)}/#token=${token}`;
}
