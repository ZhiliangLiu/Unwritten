import { t } from './strings.ts';

export type MenuRole =
  | 'about'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'resetZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'togglefullscreen'
  | 'minimize'
  | 'close'
  | 'toggleDevTools';

export interface MenuItemSpec {
  label?: string;
  role?: MenuRole;
  accelerator?: string;
  visible?: boolean;
  type?: 'separator';
  submenu?: MenuItemSpec[];
}

export function buildMenuTemplate(input: { platform: NodeJS.Platform; dev: boolean }): MenuItemSpec[] {
  const edit: MenuItemSpec[] = [
    { label: t('desktop:menu.undo'), role: 'undo' },
    { label: t('desktop:menu.redo'), role: 'redo' },
    { type: 'separator' },
    { label: t('desktop:menu.cut'), role: 'cut' },
    { label: t('desktop:menu.copy'), role: 'copy' },
    { label: t('desktop:menu.paste'), role: 'paste' },
    { label: t('desktop:menu.selectAll'), role: 'selectAll' },
  ];

  const view: MenuItemSpec[] = [
    { label: t('desktop:menu.resetZoom'), role: 'resetZoom', accelerator: 'CommandOrControl+0' },
    { label: t('desktop:menu.zoomIn'), role: 'zoomIn', accelerator: 'CommandOrControl+Plus' },
    { label: t('desktop:menu.zoomIn'), role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false },
    { label: t('desktop:menu.zoomOut'), role: 'zoomOut', accelerator: 'CommandOrControl+-' },
    { type: 'separator' },
    { label: t('desktop:menu.fullscreen'), role: 'togglefullscreen' },
  ];
  if (input.dev) {
    view.push({ type: 'separator' }, { label: t('desktop:menu.devTools'), role: 'toggleDevTools' });
  }

  const windowMenu: MenuItemSpec[] = [
    { label: t('desktop:menu.minimize'), role: 'minimize' },
    { label: t('desktop:menu.close'), role: 'close' },
  ];
  if (input.platform !== 'darwin') {
    windowMenu.push({ type: 'separator' }, { label: t('desktop:menu.quit'), role: 'quit' });
  }

  const template: MenuItemSpec[] = [];
  if (input.platform === 'darwin') {
    template.push({
      label: t('desktop:app.name'),
      submenu: [
        { label: t('desktop:menu.about'), role: 'about' },
        { type: 'separator' },
        { label: t('desktop:menu.hide'), role: 'hide' },
        { label: t('desktop:menu.hideOthers'), role: 'hideOthers' },
        { label: t('desktop:menu.unhide'), role: 'unhide' },
        { type: 'separator' },
        { label: t('desktop:menu.quit'), role: 'quit' },
      ],
    });
  }

  template.push(
    { label: t('desktop:menu.edit'), submenu: edit },
    { label: t('desktop:menu.view'), submenu: view },
    { label: t('desktop:menu.window'), submenu: windowMenu },
  );

  return template;
}
