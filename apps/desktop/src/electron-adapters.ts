import {
  Menu,
  dialog,
  nativeTheme,
  utilityProcess,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import type { ReadyMessage } from '@unwritten/contracts/desktop';
import type { CoreProcessDeps } from './core-process.ts';
import type { MenuItemSpec } from './menu-template.ts';
import type { DialogSpec } from './startup-error.ts';

export function forkUtilityCore(input: { inheritStdio: boolean }): CoreProcessDeps['fork'] {
  return (entry, env) => {
    const child = utilityProcess.fork(entry, [], {
      env,
      stdio: input.inheritStdio ? 'inherit' : 'ignore',
      serviceName: 'core',
    });
    return {
      postMessage(message) {
        child.postMessage(message);
      },
      onMessage(listener) {
        child.on('message', listener);
      },
      onExit(listener) {
        child.on('exit', listener);
      },
      kill() {
        child.kill();
      },
    };
  };
}

export async function showDialog(window: BrowserWindow | null, spec: DialogSpec): Promise<number> {
  const result = window ? await dialog.showMessageBox(window, spec) : await dialog.showMessageBox(spec);
  return result.response;
}

export function applyThemeSource(appearance: ReadyMessage['appearance']['appearance']): void {
  nativeTheme.themeSource = appearance;
}

export function installMenu(template: MenuItemSpec[]): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template as MenuItemConstructorOptions[]));
}
