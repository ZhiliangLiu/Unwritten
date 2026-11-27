import { describe, expect, it } from 'vitest';
import { buildMenuTemplate, type MenuItemSpec } from './menu-template.ts';

function collectRoles(items: MenuItemSpec[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(item.submenu ? collectRoles(item.submenu) : []),
  ]);
}

function collectAccelerators(items: MenuItemSpec[]): string[] {
  return items.flatMap((item) => [
    ...(item.accelerator ? [item.accelerator] : []),
    ...(item.submenu ? collectAccelerators(item.submenu) : []),
  ]);
}

function collectLabels(items: MenuItemSpec[]): string[] {
  return items.flatMap((item) => [
    ...(item.type === 'separator' ? [] : [item.label ?? '']),
    ...(item.submenu ? collectLabels(item.submenu) : []),
  ]);
}

describe('buildMenuTemplate', () => {
  it('菜单里没有原地刷新', () => {
    const roles = collectRoles(buildMenuTemplate({ platform: 'darwin', dev: true }));
    expect(roles.length).toBeGreaterThan(0);
    expect(roles).toContain('zoomIn');
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('forceReload');
  });

  it('打包后没有开发者工具', () => {
    expect(collectRoles(buildMenuTemplate({ platform: 'darwin', dev: false }))).not.toContain('toggleDevTools');
    expect(collectRoles(buildMenuTemplate({ platform: 'darwin', dev: true }))).toContain('toggleDevTools');
  });

  it('缩放三件套都有快捷键', () => {
    const accelerators = collectAccelerators(buildMenuTemplate({ platform: 'darwin', dev: false }));
    expect(accelerators).toContain('CommandOrControl+0');
    expect(accelerators).toContain('CommandOrControl+Plus');
    expect(accelerators).toContain('CommandOrControl+-');
  });

  it('每一项可见的菜单都有中文 label', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const labels = collectLabels(buildMenuTemplate({ platform, dev: true }));
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });
});
