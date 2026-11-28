import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGE_MAX_PIXELS } from './limits.ts';
import { aspectMatches, validateImageBytes, type ImageRejectReason } from './validate.ts';
import { TINY_WEBP, jpegHeaderBytes, pngBytes, webpHeaderBytes } from '../test-support/image-bytes.ts';

const REJECT_REASONS: ImageRejectReason[] = [
  'too_large',
  'unknown_type',
  'svg',
  'truncated',
  'bad_dimensions',
  'too_many_pixels',
  'animated',
  'metadata',
];

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

describe('validateImageBytes', () => {
  it('接受 PNG 并读出宽高', () => {
    const bytes = pngBytes(1536, 1024);
    expect(validateImageBytes(bytes)).toEqual({
      ok: true,
      image: { mime: 'image/png', ext: 'png', width: 1536, height: 1024, bytes: bytes.length },
    });
  });

  it('要求拒收元数据时拒绝 PNG 文本块', () => {
    expect(validateImageBytes(pngBytes(1, 1, { textChunk: 'prompt' }), { rejectMetadata: true })).toEqual({
      ok: false,
      reason: 'metadata',
    });
  });

  it('没有要求时保留 PNG 文本块', () => {
    expect(validateImageBytes(pngBytes(1, 1, { textChunk: 'prompt' }))).toMatchObject({
      ok: true,
      image: { mime: 'image/png' },
    });
  });

  it('拒绝 PNG 动图', () => {
    expect(validateImageBytes(pngBytes(1, 1, { animated: true }))).toEqual({ ok: false, reason: 'animated' });
  });

  it('拒绝缺少结尾的 PNG', () => {
    const bytes = pngBytes(1, 1);
    expect(validateImageBytes(bytes.subarray(0, bytes.length - 10))).toEqual({ ok: false, reason: 'truncated' });
  });

  it('要求拒收元数据时拒绝 PNG 的 eXIf 块', () => {
    expect(validateImageBytes(pngBytes(1, 1, { exif: true }), { rejectMetadata: true })).toEqual({
      ok: false,
      reason: 'metadata',
    });
  });

  it('要求拒收元数据时拒绝 WebP 的 EXIF 标志', () => {
    expect(validateImageBytes(webpHeaderBytes(2, 2, { exif: true }), { rejectMetadata: true })).toEqual({
      ok: false,
      reason: 'metadata',
    });
  });

  it('拒绝 WebP 动图', () => {
    expect(validateImageBytes(webpHeaderBytes(2, 2, { animated: true }))).toEqual({ ok: false, reason: 'animated' });
  });

  it('要求拒收元数据时拒绝 JPEG 的 Exif 段', () => {
    expect(validateImageBytes(jpegHeaderBytes(4, 4, { exif: true }), { rejectMetadata: true })).toEqual({
      ok: false,
      reason: 'metadata',
    });
  });

  it('要求拒收元数据时拒绝 JPEG 的 XMP 段', () => {
    expect(validateImageBytes(jpegHeaderBytes(4, 4, { xmp: true }), { rejectMetadata: true })).toEqual({
      ok: false,
      reason: 'metadata',
    });
  });

  it('要求拒收元数据时拒绝 JPEG 注释段', () => {
    expect(validateImageBytes(jpegHeaderBytes(4, 4, { comment: true }), { rejectMetadata: true })).toEqual({
      ok: false,
      reason: 'metadata',
    });
  });

  it('拒绝 SVG', () => {
    expect(validateImageBytes(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({
      ok: false,
      reason: 'svg',
    });
  });

  it('跳过 BOM 和空白后仍识别 SVG', () => {
    expect(validateImageBytes(new TextEncoder().encode('\uFEFF  <svg/>'))).toEqual({ ok: false, reason: 'svg' });
  });

  it('按文件头拒绝其他类型', () => {
    expect(validateImageBytes(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toEqual({
      ok: false,
      reason: 'unknown_type',
    });
  });

  it('先判断大小再判断类型', () => {
    expect(validateImageBytes(new Uint8Array(IMAGE_MAX_BYTES + 1))).toEqual({ ok: false, reason: 'too_large' });
  });

  it('拒绝像素过多的 WebP', () => {
    expect(validateImageBytes(webpHeaderBytes(8000, 8000))).toEqual({ ok: false, reason: 'too_many_pixels' });
  });

  it('拒绝宽为 0 的 PNG', () => {
    expect(validateImageBytes(pngBytes(0, 5))).toEqual({ ok: false, reason: 'bad_dimensions' });
  });

  it('随机字节不抛异常且结果合法', () => {
    const random = mulberry32(0x5eed);
    for (let sample = 0; sample < 1000; sample += 1) {
      const bytes = new Uint8Array(Math.floor(random() * 65));
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(random() * 256);
      }
      const result = validateImageBytes(bytes);
      if (result.ok) {
        expect(['image/png', 'image/jpeg', 'image/webp']).toContain(result.image.mime);
        expect(result.image.width).toBeGreaterThan(0);
        expect(result.image.height).toBeGreaterThan(0);
        expect(result.image.width * result.image.height).toBeLessThanOrEqual(IMAGE_MAX_PIXELS);
        expect(result.image.bytes).toBe(bytes.length);
      } else {
        expect(REJECT_REASONS).toContain(result.reason);
      }
    }
  });

  it('截断到任意长度都不抛异常', () => {
    const fixtures = [pngBytes(3, 2), jpegHeaderBytes(640, 480), webpHeaderBytes(1536, 1024), TINY_WEBP];
    for (const fixture of fixtures) {
      for (let length = 0; length <= fixture.length; length += 1) {
        expect(() => validateImageBytes(fixture.subarray(0, length))).not.toThrow();
      }
    }
  });
});

describe('aspectMatches', () => {
  it('接受精确的 3:2', () => {
    expect(aspectMatches(1536, 1024, '3:2')).toBe(true);
  });

  it('接受 0.4% 的偏差', () => {
    expect(aspectMatches(1024, 1360, '3:4')).toBe(true);
  });

  it('拒绝不符的比例', () => {
    expect(aspectMatches(1000, 1000, '3:2')).toBe(false);
  });

  it('格式不对时返回 false', () => {
    expect(aspectMatches(1, 1, 'x')).toBe(false);
  });
});
