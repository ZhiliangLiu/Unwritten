import type { IllustrationView, TurnView } from '@unwritten/contracts';

function ratioOf(width: number | undefined, height: number | undefined): number | null {
  if (width === undefined || height === undefined || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return width / height;
}

function parseAspect(aspect: string): number | null {
  const [width, height] = aspect.split(':').map(Number);
  return ratioOf(width, height);
}

export function frameAspect(illustration: IllustrationView): number | null {
  const image = ratioOf(illustration.image?.width, illustration.image?.height);
  if (image !== null) return image;
  const size = ratioOf(illustration.format?.size?.width, illustration.format?.size?.height);
  if (size !== null) return size;
  const aspect = illustration.format?.aspectPreference;
  return aspect === undefined ? null : parseAspect(aspect);
}

export function placementOf(turn: TurnView): number {
  return turn.illustration?.para ?? 0;
}
