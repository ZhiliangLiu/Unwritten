import type { IllustrationStyle, PortraitSlot } from '@unwritten/contracts';
import { styleFragment } from './style.ts';

const PREVIEW_SUBJECT =
  'A small paper lantern and a single white flower on a wooden windowsill, soft afternoon light, a quiet still life, no people, no lettering.';

function styleText(style: IllustrationStyle): string {
  return styleFragment(style) ?? (style.kind === 'custom' ? `style: ${style.text}` : '');
}

function compose(body: string, style: IllustrationStyle): string {
  const fragment = styleText(style);
  return fragment ? `${body}, ${fragment}` : body;
}

export function frontPrompt(appearance: string, style: IllustrationStyle): string {
  return compose(
    `Eye-level, straight-on head-and-shoulders portrait of one person. Show the face, hairline and distinctive asymmetries. Relaxed expression, simple clothing, plain background. Visible appearance: ${appearance.trim()}`,
    style,
  );
}

export function viewPrompt(view: Exclude<PortraitSlot, 'front'>, style: IllustrationStyle): string {
  const body =
    view === 'three_quarter'
      ? 'The same person as {{ref:1}}, head and shoulders at a three-quarter angle. Make the nose bridge, jawline and side contour clear. Preserve the facial features and hairline. Relaxed expression, simple clothing, plain background.'
      : 'The same person as {{ref:1}}, standing naturally with the whole figure visible from head to feet. Show the build and proportions clearly. Relaxed expression, simple clothing, plain background.';
  return compose(body, style);
}

export function previewPrompt(style: IllustrationStyle): string {
  return compose(PREVIEW_SUBJECT, style);
}
