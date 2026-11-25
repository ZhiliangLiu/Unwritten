import type { Appearance } from "@unwritten/contracts";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function resolveTheme(preference: Appearance["appearance"]): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function applyAppearance(preference: Appearance["appearance"]): void {
  const root = document.documentElement;
  const theme = resolveTheme(preference);
  if (root.getAttribute("data-uw-theme") === theme) return;
  const swap = () => root.setAttribute("data-uw-theme", theme);
  if (typeof document.startViewTransition !== "function") {
    swap();
    return;
  }
  root.setAttribute("data-uw-theme-switching", "");
  const transition = document.startViewTransition(swap);
  void transition.finished.finally(() => root.removeAttribute("data-uw-theme-switching"));
}

export function followSystemAppearance(): () => void {
  const query = window.matchMedia(DARK_QUERY);
  const listener = () => applyAppearance(readPreference());
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function readPreference(): Appearance["appearance"] {
  const value = document.documentElement.getAttribute("data-uw-appearance");
  return value === "light" || value === "dark" ? value : "system";
}
