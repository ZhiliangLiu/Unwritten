export { IMAGE_MAX_BYTES, IMAGE_MAX_PIXELS } from '@unwritten/contracts';

export const IMAGE_ASPECT_TOLERANCE = 0.02;
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];
export const IMAGE_EXTENSION: Record<ImageMime, 'png' | 'jpg' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
