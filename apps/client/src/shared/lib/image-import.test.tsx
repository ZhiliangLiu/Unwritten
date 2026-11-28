import { IMAGE_MAX_BYTES } from '@unwritten/contracts';
import { describe, expect, it } from 'vitest';
import { PORTRAIT_UPLOAD_FILE_NAME, prepareImportedImage } from './image-import.ts';

async function pngFile(width: number, height: number, name: string): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.fillRect(0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new File([blob], name, { type: 'image/png' });
}

describe('prepareImportedImage', () => {
  it('缩放到长边上限并重新编码', async () => {
    const result = await prepareImportedImage(await pngFile(3000, 2000, 'photo.png'));
    expect(result).toMatchObject({ ok: true, width: 1536, height: 1024 });
    if (!result.ok) return;
    expect([PORTRAIT_UPLOAD_FILE_NAME.webp, PORTRAIT_UPLOAD_FILE_NAME.png]).toContain(result.file.name);
  });

  it('结果文件名与原文件名无关', async () => {
    const result = await prepareImportedImage(await pngFile(20, 20, 'secret-name.png'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.name).not.toContain('secret');
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
  });

  it('按文件头判断类型，不看声明的类型', async () => {
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'image.png', { type: 'image/png' });
    expect(await prepareImportedImage(file)).toEqual({ ok: false, problem: 'type' });
  });

  it('超过字节上限时不读图', async () => {
    const bytes = new Uint8Array(IMAGE_MAX_BYTES + 1);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = new File([bytes], 'big.png', { type: 'image/png' });
    expect(await prepareImportedImage(file)).toEqual({ ok: false, problem: 'too_large' });
  });
});
