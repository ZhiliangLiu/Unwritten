import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, nativeImage, nativeTheme } from 'electron';
import { shellEnv } from 'shell-env';
import type { DESKTOP_PLATFORMS } from '@unwritten/contracts/desktop';
import { createCoreProcess } from './core-process.ts';
import { createDesktopDiagnostics } from './diagnostics.ts';
import { applyThemeSource, forkUtilityCore, installMenu, showDialog } from './electron-adapters.ts';
import { buildMenuTemplate } from './menu-template.ts';
import { allowedOrigin, resolveDataDir, resolveDesktopPaths, windowUrl } from './paths.ts';
import { resolveShellEnv } from './shell-env.ts';
import { crashDialog, startFailureDialog } from './startup-error.ts';
import { createMainWindow, type MainWindow } from './window.ts';

const dataDir = resolveDataDir({
  env: process.env,
  userDataPath: app.getPath('userData'),
  cwd: process.cwd(),
});
app.setPath('userData', dataDir);

function platformOf(platform: NodeJS.Platform): (typeof DESKTOP_PLATFORMS)[number] {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') return platform;
  return 'other';
}

async function boot(): Promise<void> {
  const diagnostics = createDesktopDiagnostics();
  const paths = resolveDesktopPaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appDir: path.dirname(fileURLToPath(import.meta.url)),
    env: process.env,
    dataDir,
  });
  diagnostics.record({
    event: 'desktop.started',
    level: 'info',
    data: { packaged: app.isPackaged, dev: paths.mode === 'dev', platform: platformOf(process.platform) },
  });

  let mainWindow: MainWindow | null = null;

  app.on('second-instance', () => mainWindow?.focus());
  app.on('window-all-closed', () => app.quit());

  await app.whenReady();
  installMenu(buildMenuTemplate({ platform: process.platform, dev: paths.mode === 'dev' }));

  const applyDockIcon = (): void => {
    if (process.platform !== 'darwin') return;
    const name = nativeTheme.shouldUseDarkColors ? 'icon-dark.png' : 'icon-light.png';
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, name)
      : path.join(app.getAppPath(), 'build', name);
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) app.dock?.setIcon(icon);
  };
  applyDockIcon();
  nativeTheme.on('updated', applyDockIcon);

  const shell = await resolveShellEnv({
    platform: process.platform,
    base: process.env,
    read: () => shellEnv(),
  });
  diagnostics.record({
    event: 'desktop.shell_env',
    level: shell.ok ? 'info' : 'warn',
    data: { ok: shell.ok, timedOut: shell.timedOut, vars: shell.vars },
  });

  const core = createCoreProcess({
    fork: forkUtilityCore({ inheritStdio: !app.isPackaged }),
    setTimer: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    now: () => performance.now(),
    createToken: () => randomBytes(32).toString('base64url'),
    diagnostics,
  });

  core.onAppearanceChanged((appearance) => applyThemeSource(appearance.appearance));
  core.onUnexpectedExit(() => void handleCrash());

  let stopped = false;
  app.on('before-quit', (event) => {
    if (stopped) return;
    event.preventDefault();
    void core.stop().finally(() => {
      stopped = true;
      app.quit();
    });
  });

  async function launch(reason: 'initial' | 'retry' | 'restart'): Promise<void> {
    if (reason !== 'initial') {
      diagnostics.record({ event: 'desktop.core_restarted', level: 'info', data: { reason } });
    }

    const result = await core.start({
      entry: paths.coreEntry,
      env: shell.env,
      start: {
        dataDir: paths.dataDir,
        port: paths.port,
        clientDir: paths.clientDir,
        clientOrigin: paths.clientOrigin,
        logLevel: paths.mode === 'dev' ? 'debug' : 'info',
      },
    });

    if (!result.ok) {
      const response = await showDialog(mainWindow?.browserWindow ?? null, startFailureDialog(result));
      if (response === 0) await launch('retry');
      else app.quit();
      return;
    }

    applyThemeSource(result.appearance.appearance);
    if (!mainWindow) {
      const createdAt = performance.now();
      mainWindow = createMainWindow({
        diagnostics,
        onFirstShow: () =>
          diagnostics.sample({
            metric: 'desktop.window_ready',
            durationMs: performance.now() - createdAt,
            outcome: 'ok',
          }),
      });
    }
    mainWindow.load(windowUrl(paths, result.port, result.token), allowedOrigin(paths, result.port));
  }

  async function handleCrash(): Promise<void> {
    const response = await showDialog(mainWindow?.browserWindow ?? null, crashDialog(null));
    if (response === 0) await launch('restart');
    else app.quit();
  }

  await launch('initial');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void boot();
}
