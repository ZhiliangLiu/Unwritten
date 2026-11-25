import type { BackendModule } from 'i18next';

const loaders = import.meta.glob<Record<string, unknown>>('./zh-CN/*.json', { import: 'default' });

export const lazyNamespaceBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const load = loaders[`./${language}/${namespace}.json`];
    if (!load) {
      callback(new Error(`missing i18n namespace ${language}/${namespace}`), false);
      return;
    }
    load().then(
      (resources) => callback(null, resources),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), false),
    );
  },
};
