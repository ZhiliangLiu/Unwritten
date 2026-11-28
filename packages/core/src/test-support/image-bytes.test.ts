import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { TINY_WEBP, jpegHeaderBytes, pngBytes, webpHeaderBytes } from './image-bytes.ts';
import { validateImageBytes } from '../image/validate.ts';

function pngChunkData(bytes: Uint8Array, type: string): Buffer {
  const buffer = Buffer.from(bytes);
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (buffer.toString('latin1', offset + 4, offset + 8) === type) {
      return buffer.subarray(offset + 8, offset + 8 + length);
    }
    offset += 12 + length;
  }
  throw new Error(`missing PNG chunk ${type}`);
}

describe('pngBytes', () => {
  it('生成能通过校验的 PNG', () => {
    const bytes = pngBytes(3, 2);
    expect(validateImageBytes(bytes)).toEqual({
      ok: true,
      image: { mime: 'image/png', ext: 'png', width: 3, height: 2, bytes: bytes.length },
    });
  });

  it('IDAT 解压后是完整的扫描行', () => {
    const inflated = inflateSync(pngChunkData(pngBytes(3, 2), 'IDAT'));
    expect(inflated.length).toBe(20);
  });
});

describe('TINY_WEBP', () => {
  it('是 1×1 的 WebP', () => {
    expect(validateImageBytes(TINY_WEBP)).toMatchObject({
      ok: true,
      image: { mime: 'image/webp', ext: 'webp', width: 1, height: 1 },
    });
  });
});

describe('webpHeaderBytes', () => {
  it('画布尺寸来自 VP8X', () => {
    expect(validateImageBytes(webpHeaderBytes(1536, 1024))).toMatchObject({
      ok: true,
      image: { mime: 'image/webp', width: 1536, height: 1024 },
    });
  });
});

describe('jpegHeaderBytes', () => {
  it('帧头尺寸可读出', () => {
    expect(validateImageBytes(jpegHeaderBytes(640, 480))).toMatchObject({
      ok: true,
      image: { mime: 'image/jpeg', ext: 'jpg', width: 640, height: 480 },
    });
  });
});
