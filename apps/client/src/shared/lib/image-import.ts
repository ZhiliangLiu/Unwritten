import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  PORTRAIT_IMPORT_MAX_BYTES,
  PORTRAIT_IMPORT_MAX_EDGE,
} from '@unwritten/contracts';

export type ImportProblem = 'type' | 'too_large' | 'too_many_pixels' | 'decode' | 'encode';

export type PreparedImport =
  { ok: true; file: File; width: number; height: number } | { ok: false; problem: ImportProblem };

export const PORTRAIT_UPLOAD_FILE_NAME = { webp: 'portrait.webp', png: 'portrait.png' } as const;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function matchesBytes(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (offset + signature.length > bytes.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

function isSupportedType(head: Uint8Array): boolean {
  return (
    matchesBytes(head, 0, PNG_SIGNATURE) ||
    matchesBytes(head, 0, JPEG_SIGNATURE) ||
    (matchesAscii(head, 0, 'RIFF') && matchesAscii(head, 8, 'WEBP'))
  );
}

type EncodedPortrait = { blob: Blob; extension: 'webp' | 'png' };

async function encodePortrait(canvas: OffscreenCanvas): Promise<EncodedPortrait | 'too_large' | 'encode'> {
  try {
    for (const quality of [0.9, 0.8, 0.7]) {
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality });
      if (blob.type !== 'image/webp') {
        if (blob.type !== 'image/png') return 'encode';
        return blob.size <= PORTRAIT_IMPORT_MAX_BYTES ? { blob, extension: 'png' } : 'too_large';
      }
      if (blob.size <= PORTRAIT_IMPORT_MAX_BYTES) return { blob, extension: 'webp' };
    }
    return 'too_large';
  } catch {
    return 'encode';
  }
}

export async function prepareImportedImage(file: File): Promise<PreparedImport> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!isSupportedType(head)) return { ok: false, problem: 'type' };
  if (file.size > IMAGE_MAX_BYTES) return { ok: false, problem: 'too_large' };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, problem: 'decode' };
  }

  try {
    if (bitmap.width * bitmap.height > IMAGE_MAX_PIXELS) return { ok: false, problem: 'too_many_pixels' };
    const scale = Math.min(1, PORTRAIT_IMPORT_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return { ok: false, problem: 'encode' };
    context.drawImage(bitmap, 0, 0, width, height);

    const encoded = await encodePortrait(canvas);
    if (encoded === 'too_large' || encoded === 'encode') return { ok: false, problem: encoded };
    return {
      ok: true,
      file: new File([encoded.blob], PORTRAIT_UPLOAD_FILE_NAME[encoded.extension], { type: encoded.blob.type }),
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}
