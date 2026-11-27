import type { Appearance } from '@unwritten/contracts';
import { AppearanceSchema, DEFAULT_APPEARANCE } from '@unwritten/contracts';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function resolveTheme(preference: Appearance['appearance']): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function readAppearance(): Appearance {
  const root = document.documentElement;
  const { shape } = AppearanceSchema;
  const fallback = DEFAULT_APPEARANCE;
  return {
    appearance: shape.appearance.catch(fallback.appearance).parse(root.getAttribute('data-uw-appearance')),
    proseSize: shape.proseSize.catch(fallback.proseSize).parse(root.getAttribute('data-uw-prose-size')),
    proseFont: shape.proseFont.catch(fallback.proseFont).parse(root.getAttribute('data-uw-prose-font')),
    proseLeading: shape.proseLeading.catch(fallback.proseLeading).parse(root.getAttribute('data-uw-prose-leading')),
    proseLayout: shape.proseLayout.catch(fallback.proseLayout).parse(root.getAttribute('data-uw-prose-layout')),
    proseIndent: shape.proseIndent.catch(fallback.proseIndent).parse(root.getAttribute('data-uw-prose-indent')),
  };
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.setAttribute('data-uw-appearance', appearance.appearance);
  root.setAttribute('data-uw-prose-size', appearance.proseSize);
  root.setAttribute('data-uw-prose-font', appearance.proseFont);
  root.setAttribute('data-uw-prose-leading', appearance.proseLeading);
  root.setAttribute('data-uw-prose-layout', appearance.proseLayout);
  root.setAttribute('data-uw-prose-indent', appearance.proseIndent);
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
