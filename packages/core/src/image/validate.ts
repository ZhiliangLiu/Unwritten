import {
  IMAGE_ASPECT_TOLERANCE,
  IMAGE_EXTENSION,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PIXELS,
  type ImageMime,
} from './limits.ts';

export type ImageRejectReason =
  'too_large' | 'unknown_type' | 'svg' | 'truncated' | 'bad_dimensions' | 'too_many_pixels' | 'animated' | 'metadata';

export interface ValidatedImage {
  mime: ImageMime;
  ext: 'png' | 'jpg' | 'webp';
  width: number;
  height: number;
  bytes: number;
}

export type ImageValidation = { ok: true; image: ValidatedImage } | { ok: false; reason: ImageRejectReason };

interface Dimensions {
  width: number;
  height: number;
}

type ParsedHeader = { ok: true; dimensions: Dimensions; metadata: boolean } | { ok: false; reason: ImageRejectReason };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const WHITESPACE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]);
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const EXIF_PREFIX = 'Exif\0\0';
const XMP_PREFIX = 'http://ns.adobe.com/xap/1.0/\0';

function byteAt(bytes: Uint8Array, offset: number): number | null {
  const value = bytes[offset];
  return value === undefined ? null : value;
}

function readUInt16BE(bytes: Uint8Array, offset: number): number | null {
  const high = byteAt(bytes, offset);
  const low = byteAt(bytes, offset + 1);
  if (high === null || low === null) return null;
  return (high << 8) | low;
}

function readUInt16LE(bytes: Uint8Array, offset: number): number | null {
  const low = byteAt(bytes, offset);
  const high = byteAt(bytes, offset + 1);
  if (low === null || high === null) return null;
  return (high << 8) | low;
}

function readUInt24LE(bytes: Uint8Array, offset: number): number | null {
  const low = byteAt(bytes, offset);
  const middle = byteAt(bytes, offset + 1);
  const high = byteAt(bytes, offset + 2);
  if (low === null || middle === null || high === null) return null;
  return low | (middle << 8) | (high << 16);
}

function readUInt32BE(bytes: Uint8Array, offset: number): number | null {
  const first = byteAt(bytes, offset);
  const second = byteAt(bytes, offset + 1);
  const third = byteAt(bytes, offset + 2);
  const fourth = byteAt(bytes, offset + 3);
  if (first === null || second === null || third === null || fourth === null) return null;
  return ((first << 24) | (second << 16) | (third << 8) | fourth) >>> 0;
}

function readUInt32LE(bytes: Uint8Array, offset: number): number | null {
  const first = byteAt(bytes, offset);
  const second = byteAt(bytes, offset + 1);
  const third = byteAt(bytes, offset + 2);
  const fourth = byteAt(bytes, offset + 3);
  if (first === null || second === null || third === null || fourth === null) return null;
  return ((fourth << 24) | (third << 16) | (second << 8) | first) >>> 0;
}

function matchesBytes(bytes: Uint8Array, offset: number, pattern: readonly number[]): boolean {
  if (offset < 0 || offset + pattern.length > bytes.length) return false;
  for (let index = 0; index < pattern.length; index += 1) {
    if (bytes[offset + index] !== pattern[index]) return false;
  }
  return true;
}

function matchesAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset < 0 || offset + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function rejected(reason: ImageRejectReason): ParsedHeader {
  return { ok: false, reason };
}

function detectMime(bytes: Uint8Array): ImageMime | null {
  if (matchesBytes(bytes, 0, PNG_SIGNATURE)) return 'image/png';
  if (matchesBytes(bytes, 0, JPEG_SIGNATURE)) return 'image/jpeg';
  if (matchesAscii(bytes, 0, 'RIFF') && matchesAscii(bytes, 8, 'WEBP')) return 'image/webp';
  return null;
}

function parsePng(bytes: Uint8Array): ParsedHeader {
  let offset: number = PNG_SIGNATURE.length;
  let dimensions: Dimensions | null = null;
  let metadata = false;

  while (offset < bytes.length) {
    const length = readUInt32BE(bytes, offset);
    if (length === null) return rejected('truncated');
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + length + 4;
    if (chunkEnd > bytes.length) return rejected('truncated');

    if (dimensions === null) {
      if (length < 8 || !matchesAscii(bytes, typeOffset, 'IHDR')) return rejected('truncated');
      const width = readUInt32BE(bytes, dataOffset);
      const height = readUInt32BE(bytes, dataOffset + 4);
      if (width === null || height === null) return rejected('truncated');
      dimensions = { width, height };
    } else if (matchesAscii(bytes, typeOffset, 'acTL')) {
      return rejected('animated');
    } else if (
      matchesAscii(bytes, typeOffset, 'tEXt') ||
      matchesAscii(bytes, typeOffset, 'zTXt') ||
      matchesAscii(bytes, typeOffset, 'iTXt') ||
      matchesAscii(bytes, typeOffset, 'eXIf')
    ) {
      metadata = true;
    } else if (matchesAscii(bytes, typeOffset, 'IEND')) {
      return { ok: true, dimensions, metadata };
    }

    offset = chunkEnd;
  }

  return rejected('truncated');
}

function parseJpeg(bytes: Uint8Array): ParsedHeader {
  let offset = 2;
  let dimensions: Dimensions | null = null;
  let metadata = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return rejected('truncated');
    let markerOffset = offset + 1;
    while (bytes[markerOffset] === 0xff) markerOffset += 1;
    const marker = byteAt(bytes, markerOffset);
    if (marker === null) return rejected('truncated');
    if (marker === 0xda) break;
    const segmentOffset = markerOffset + 1;

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = segmentOffset;
      continue;
    }

    const length = readUInt16BE(bytes, segmentOffset);
    if (length === null || length < 2) return rejected('truncated');
    const segmentEnd = segmentOffset + length;
    if (segmentEnd > bytes.length) return rejected('truncated');

    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (length < 7) return rejected('truncated');
      const height = readUInt16BE(bytes, segmentOffset + 3);
      const width = readUInt16BE(bytes, segmentOffset + 5);
      if (height === null || width === null) return rejected('truncated');
      dimensions = { width, height };
    } else if (marker === 0xe1) {
      const dataOffset = segmentOffset + 2;
      const dataLength = length - 2;
      if (
        (dataLength >= EXIF_PREFIX.length && matchesAscii(bytes, dataOffset, EXIF_PREFIX)) ||
        (dataLength >= XMP_PREFIX.length && matchesAscii(bytes, dataOffset, XMP_PREFIX))
      ) {
        metadata = true;
      }
    } else if (marker === 0xfe) {
      metadata = true;
    }

    offset = segmentEnd;
  }

  if (dimensions === null) return rejected('truncated');
  return { ok: true, dimensions, metadata };
}

function parseWebp(bytes: Uint8Array): ParsedHeader {
  let offset = 12;
  let canvas: Dimensions | null = null;
  let frame: Dimensions | null = null;
  let metadata = false;

  while (offset < bytes.length) {
    const length = readUInt32LE(bytes, offset + 4);
    if (length === null) return rejected('truncated');
    const dataOffset = offset + 8;
    const paddedLength = length + (length % 2);
    if (dataOffset + paddedLength > bytes.length) return rejected('truncated');

    if (matchesAscii(bytes, offset, 'VP8X')) {
      if (length < 10) return rejected('truncated');
      const flags = byteAt(bytes, dataOffset);
      const width = readUInt24LE(bytes, dataOffset + 4);
      const height = readUInt24LE(bytes, dataOffset + 7);
      if (flags === null || width === null || height === null) return rejected('truncated');
      if ((flags & 0x02) !== 0) return rejected('animated');
      if ((flags & 0x0c) !== 0) metadata = true;
      canvas = { width: width + 1, height: height + 1 };
    } else if (matchesAscii(bytes, offset, 'VP8 ')) {
      if (canvas === null) {
        if (length < 10) return rejected('truncated');
        if (!matchesBytes(bytes, dataOffset + 3, [0x9d, 0x01, 0x2a])) return rejected('truncated');
        const width = readUInt16LE(bytes, dataOffset + 6);
        const height = readUInt16LE(bytes, dataOffset + 8);
        if (width === null || height === null) return rejected('truncated');
        frame = { width: width & 0x3fff, height: height & 0x3fff };
      }
    } else if (matchesAscii(bytes, offset, 'VP8L')) {
      if (canvas === null) {
        if (length < 5) return rejected('truncated');
        if (byteAt(bytes, dataOffset) !== 0x2f) return rejected('truncated');
        const packed = readUInt32LE(bytes, dataOffset + 1);
        if (packed === null) return rejected('truncated');
        frame = { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
      }
    } else if (matchesAscii(bytes, offset, 'ANIM') || matchesAscii(bytes, offset, 'ANMF')) {
      return rejected('animated');
    } else if (matchesAscii(bytes, offset, 'EXIF') || matchesAscii(bytes, offset, 'XMP ')) {
      metadata = true;
    }

    offset = dataOffset + paddedLength;
  }

  const dimensions = canvas ?? frame;
  if (dimensions === null) return rejected('truncated');
  return { ok: true, dimensions, metadata };
}

export function validateImageBytes(
  bytes: Uint8Array,
  options: { maxBytes?: number; rejectMetadata?: boolean } = {},
): ImageValidation {
  if (bytes.length > (options.maxBytes ?? IMAGE_MAX_BYTES)) return { ok: false, reason: 'too_large' };

  let start = matchesBytes(bytes, 0, UTF8_BOM) ? UTF8_BOM.length : 0;
  while (start < bytes.length) {
    const value = bytes[start];
    if (value === undefined || !WHITESPACE.has(value)) break;
    start += 1;
  }
  if (bytes[start] === 0x3c) return { ok: false, reason: 'svg' };

  const mime = detectMime(bytes);
  if (mime === null) return { ok: false, reason: 'unknown_type' };

  const parsed = mime === 'image/png' ? parsePng(bytes) : mime === 'image/jpeg' ? parseJpeg(bytes) : parseWebp(bytes);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (parsed.dimensions.width <= 0 || parsed.dimensions.height <= 0) return { ok: false, reason: 'bad_dimensions' };
  if (parsed.dimensions.width * parsed.dimensions.height > IMAGE_MAX_PIXELS) {
    return { ok: false, reason: 'too_many_pixels' };
  }
  if (parsed.metadata && options.rejectMetadata === true) return { ok: false, reason: 'metadata' };

  return {
    ok: true,
    image: {
      mime,
      ext: IMAGE_EXTENSION[mime],
      width: parsed.dimensions.width,
      height: parsed.dimensions.height,
      bytes: bytes.length,
    },
  };
}

export function aspectMatches(
  width: number,
  height: number,
  aspect: string,
  tolerance: number = IMAGE_ASPECT_TOLERANCE,
): boolean {
  const match = /^([1-9]\d*):([1-9]\d*)$/u.exec(aspect);
  if (match === null || width <= 0 || height <= 0) return false;
  const aspectWidth = Number(match[1]);
  const aspectHeight = Number(match[2]);
  const target = aspectWidth / aspectHeight;
  return Math.abs(width / height - target) / target <= tolerance;
}
