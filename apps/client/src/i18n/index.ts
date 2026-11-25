import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { lazyNamespaceBackend } from "./backend.ts";
import common from "./zh-CN/common.json";
import errors from "./zh-CN/errors.json";

export const UI_LANGUAGE = "zh-CN";

export async function initI18n(): Promise<void> {
  await i18next
    .use(lazyNamespaceBackend)
    .use(initReactI18next)
    .init({
      lng: UI_LANGUAGE,
      fallbackLng: false,
      ns: ["common", "errors"],
      defaultNS: "common",
      resources: { [UI_LANGUAGE]: { common, errors } },
      partialBundledLanguages: true,
      interpolation: { escapeValue: false },
    });
}

export function loadNamespace(namespace: "library" | "authoring" | "play" | "settings"): Promise<void> {
  return i18next.loadNamespaces(namespace);
}
