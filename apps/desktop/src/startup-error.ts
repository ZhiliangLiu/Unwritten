import type { DesktopStartFailure } from './core-process.ts';
import { t, type DesktopStringKey } from './strings.ts';

export interface DialogSpec {
  type: 'error' | 'warning';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

const START_FAILURE_MESSAGES: Record<DesktopStartFailure, DesktopStringKey> = {
  data_locked: 'desktop:startup.reason.data_locked',
  port_in_use: 'desktop:startup.reason.port_in_use',
  data_dir: 'desktop:startup.reason.data_dir',
  startup: 'desktop:startup.reason.startup',
  timeout: 'desktop:startup.reason.timeout',
  exited: 'desktop:startup.reason.exited',
};

export function startFailureDialog(failure: { reason: DesktopStartFailure; diagnosticId: string | null }): DialogSpec {
  return {
    type: 'error',
    title: t('desktop:startup.title'),
    message: t(START_FAILURE_MESSAGES[failure.reason]),
    detail:
      failure.diagnosticId === null
        ? t('desktop:startup.noDiagnostic')
        : t('desktop:startup.diagnostic', { id: failure.diagnosticId }),
    buttons: [t('desktop:startup.retry'), t('desktop:startup.quit')],
    defaultId: 0,
    cancelId: 1,
  };
}

export function crashDialog(_code: number | null): DialogSpec {
  return {
    type: 'warning',
    title: t('desktop:crash.title'),
    message: t('desktop:crash.message'),
    detail: t('desktop:crash.detail'),
    buttons: [t('desktop:crash.restart'), t('desktop:crash.quit')],
    defaultId: 0,
    cancelId: 1,
  };
}

export function rendererGoneDialog(): DialogSpec {
  return {
    type: 'warning',
    title: t('desktop:renderer.title'),
    message: t('desktop:renderer.message'),
    detail: '',
    buttons: [t('desktop:renderer.reload'), t('desktop:renderer.quit')],
    defaultId: 0,
    cancelId: 1,
  };
}
