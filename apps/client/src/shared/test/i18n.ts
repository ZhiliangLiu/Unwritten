import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import authoring from '../../i18n/zh-CN/authoring.json';
import common from '../../i18n/zh-CN/common.json';
import errors from '../../i18n/zh-CN/errors.json';
import library from '../../i18n/zh-CN/library.json';
import play from '../../i18n/zh-CN/play.json';
import settings from '../../i18n/zh-CN/settings.json';

let initialized = false;

export function initTestI18n(): void {
  if (initialized) return;
  initialized = true;
  void i18next.use(initReactI18next).init({
    lng: 'zh-CN',
    fallbackLng: false,
    initAsync: false,
    ns: ['common', 'errors', 'library', 'authoring', 'play', 'settings'],
    defaultNS: 'common',
    resources: { 'zh-CN': { common, errors, library, authoring, play, settings } },
    interpolation: { escapeValue: false },
  });
}
