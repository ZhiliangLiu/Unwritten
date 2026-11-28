import { crc32, deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function uint32BE(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function uint32LE(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function uint16BE(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([uint32BE(data.length), body, uint32BE(crc32(body))]);
}

export function pngBytes(
  width: number,
  height: number,
  options: { textChunk?: string; exif?: boolean; animated?: boolean } = {},
): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const scanlines = Buffer.alloc((1 + width * 3) * height);
  const chunks = [PNG_SIGNATURE, pngChunk('IHDR', header)];

  if (options.animated) {
    const animation = Buffer.alloc(8);
    animation.writeUInt32BE(1, 0);
    animation.writeUInt32BE(0, 4);
    chunks.push(pngChunk('acTL', animation));
  }

  chunks.push(pngChunk('IDAT', deflateSync(scanlines)));

  if (options.exif) chunks.push(pngChunk('eXIf', Buffer.alloc(0)));
  if (options.textChunk !== undefined) {
    chunks.push(
      pngChunk('tEXt', Buffer.concat([Buffer.from('Comment\0', 'latin1'), Buffer.from(options.textChunk, 'utf8')])),
    );
  }

  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

export const TINY_WEBP: Uint8Array = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

function writeUInt24LE(buffer: Buffer, offset: number, value: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = (value >> 16) & 0xff;
}

export function webpHeaderBytes(
  width: number,
  height: number,
  options: { exif?: boolean; xmp?: boolean; animated?: boolean } = {},
): Uint8Array {
  const canvas = Buffer.alloc(10);
  canvas[0] = (options.animated ? 0x02 : 0) | (options.exif ? 0x08 : 0) | (options.xmp ? 0x04 : 0);
  writeUInt24LE(canvas, 4, width - 1);
  writeUInt24LE(canvas, 7, height - 1);

  const lossless = Buffer.alloc(8);
  lossless.write('VP8L', 0, 'latin1');

  const body = Buffer.concat([
    Buffer.from('WEBP', 'latin1'),
    Buffer.from('VP8X', 'latin1'),
    uint32LE(canvas.length),
    canvas,
    lossless,
  ]);

  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function jpegSegment(marker: number, data: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from([0xff, marker]), uint16BE(data.length + 2), data]);
}

export function jpegHeaderBytes(
  width: number,
  height: number,
  options: { exif?: boolean; xmp?: boolean; comment?: boolean } = {},
): Uint8Array {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];

  if (options.exif) parts.push(jpegSegment(0xe1, Buffer.from('Exif\0\0', 'latin1')));
  if (options.xmp) parts.push(jpegSegment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1')));
  if (options.comment) parts.push(jpegSegment(0xfe, Buffer.alloc(0)));

  const frame = Buffer.alloc(15);
  frame[0] = 8;
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = 3;
  for (let component = 0; component < 3; component += 1) {
    frame[6 + component * 3] = component + 1;
    frame[7 + component * 3] = 0x11;
    frame[8 + component * 3] = 0;
  }
  parts.push(jpegSegment(0xc0, frame));

  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x02, 0x00, 0x00, 0xff, 0xd9]));
  return Buffer.concat(parts);
}
