import zhCN from './i18n/zh-CN.json' with { type: 'json' };

export const DESKTOP_STRING_KEYS = [
  'desktop:app.name',
  'desktop:menu.about',
  'desktop:menu.hide',
  'desktop:menu.hideOthers',
  'desktop:menu.unhide',
  'desktop:menu.quit',
  'desktop:menu.edit',
  'desktop:menu.undo',
  'desktop:menu.redo',
  'desktop:menu.cut',
  'desktop:menu.copy',
  'desktop:menu.paste',
  'desktop:menu.selectAll',
  'desktop:menu.view',
  'desktop:menu.resetZoom',
  'desktop:menu.zoomIn',
  'desktop:menu.zoomOut',
  'desktop:menu.fullscreen',
  'desktop:menu.devTools',
  'desktop:menu.window',
  'desktop:menu.minimize',
  'desktop:menu.close',
  'desktop:startup.title',
  'desktop:startup.reason.data_locked',
  'desktop:startup.reason.port_in_use',
  'desktop:startup.reason.data_dir',
  'desktop:startup.reason.startup',
  'desktop:startup.reason.timeout',
  'desktop:startup.reason.exited',
  'desktop:startup.diagnostic',
  'desktop:startup.noDiagnostic',
  'desktop:startup.retry',
  'desktop:startup.quit',
  'desktop:crash.title',
  'desktop:crash.message',
  'desktop:crash.detail',
  'desktop:crash.restart',
  'desktop:crash.quit',
] as const;

export type DesktopStringKey = (typeof DESKTOP_STRING_KEYS)[number];

const STRINGS: Record<string, unknown> = zhCN;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function lookup(path: string): string {
  let current: unknown = STRINGS;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !(segment in current)) {
      throw new Error(`unknown desktop string: ${path}`);
    }
    current = current[segment];
  }
  if (typeof current !== 'string') {
    throw new Error(`unknown desktop string: ${path}`);
  }
  return current;
}

export function t(key: DesktopStringKey, vars?: Record<string, string | number>): string {
  const text = lookup(key.replace(/^desktop:/, ''));
  return text.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = vars?.[name];
    return value === undefined ? placeholder : String(value);
  });
}
