import type { Appearance } from '@unwritten/contracts';
import { DEFAULT_APPEARANCE } from '@unwritten/contracts';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function resolveTheme(preference: Appearance['appearance']): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function readAppearance(): Appearance {
  const root = document.documentElement;
  const appearance = root.getAttribute('data-uw-appearance');
  const proseSize = root.getAttribute('data-uw-prose-size');
  const proseFont = root.getAttribute('data-uw-prose-font');
  const proseLeading = root.getAttribute('data-uw-prose-leading');
  return {
    appearance:
      appearance === 'system' || appearance === 'light' || appearance === 'dark'
        ? appearance
        : DEFAULT_APPEARANCE.appearance,
    proseSize:
      proseSize === '1' || proseSize === '2' || proseSize === '3' || proseSize === '4' || proseSize === '5'
        ? proseSize
        : DEFAULT_APPEARANCE.proseSize,
    proseFont: proseFont === 'sans' ? 'sans' : 'serif',
    proseLeading: proseLeading === 'compact' ? 'compact' : 'comfortable',
  };
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.setAttribute('data-uw-appearance', appearance.appearance);
  root.setAttribute('data-uw-prose-size', appearance.proseSize);
  root.setAttribute('data-uw-prose-font', appearance.proseFont);
  root.setAttribute('data-uw-prose-leading', appearance.proseLeading);
  const theme = resolveTheme(appearance.appearance);
  if (root.getAttribute('data-uw-theme') === theme) return;
  const swap = () => root.setAttribute('data-uw-theme', theme);
  if (typeof document.startViewTransition !== 'function') {
    swap();
    return;
  }
  root.setAttribute('data-uw-theme-switching', '');
  const transition = document.startViewTransition(swap);
  void transition.finished.finally(() => root.removeAttribute('data-uw-theme-switching'));
}

export function followSystemAppearance(): () => void {
  const query = window.matchMedia(DARK_QUERY);
  const listener = () => applyAppearance(readAppearance());
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
