import { BrowserWindow, shell, type RenderProcessGoneDetails } from 'electron';
import type { DesktopDiagnostics } from './diagnostics.ts';
import { decideNavigation, decideWindowOpen } from './navigation.ts';
import { t } from './strings.ts';

export const WINDOW_DEFAULT_WIDTH = 1200;
export const WINDOW_DEFAULT_HEIGHT = 820;
export const WINDOW_MIN_WIDTH = 360;
export const WINDOW_MIN_HEIGHT = 480;

export interface MainWindow {
  readonly browserWindow: BrowserWindow;
  load(url: string, allowed: string): void;
  focus(): void;
}

export function createMainWindow(input: { diagnostics: DesktopDiagnostics; onFirstShow: () => void }): MainWindow {
  const browserWindow = new BrowserWindow({
    width: WINDOW_DEFAULT_WIDTH,
    height: WINDOW_DEFAULT_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    title: t('desktop:app.name'),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  let currentUrl = '';
  let allowed = '';
  let shown = false;

  browserWindow.on('ready-to-show', () => {
    if (shown) return;
    shown = true;
    browserWindow.show();
    input.onFirstShow();
  });

  browserWindow.webContents.on('will-navigate', (details) => {
    const decision = decideNavigation(details.url, allowed);
    if (decision.action === 'allow') return;

    details.preventDefault();
    if (decision.action === 'external') void shell.openExternal(decision.url);
    input.diagnostics.record({
      event: 'desktop.navigation_blocked',
      level: 'info',
      data: { kind: 'navigate', external: decision.action === 'external' },
    });
  });

  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(url, allowed);
    if (decision.action === 'external') void shell.openExternal(decision.url);
    input.diagnostics.record({
      event: 'desktop.navigation_blocked',
      level: 'info',
      data: { kind: 'window_open', external: decision.action === 'external' },
    });
    return { action: 'deny' };
  });

  browserWindow.webContents.on('render-process-gone', (_event, details: RenderProcessGoneDetails) => {
    input.diagnostics.record({
      event: 'desktop.renderer_gone',
      level: 'warn',
      data: { reason: details.reason },
    });
    if (currentUrl !== '') void browserWindow.loadURL(currentUrl);
  });

  return {
    browserWindow,
    load(url, allowedOrigin) {
      currentUrl = url;
      allowed = allowedOrigin;
      void browserWindow.loadURL(url);
    },
    focus() {
      if (browserWindow.isMinimized()) browserWindow.restore();
      browserWindow.focus();
    },
  };
}
