import { describe, expect, it } from 'vitest';
import { newEndpointId, newImageServiceId } from './ids.ts';

describe('newEndpointId', () => {
  it('同一个 requestId 得到同一个 id', () => {
    expect(newEndpointId('Ollama', 'req-1')).toBe(newEndpointId('Ollama', 'req-1'));
  });

  it('中文名回落到 endpoint，并符合格式', () => {
    const id = newEndpointId('本机模型', 'req-1');
    expect(id).toMatch(/^custom-endpoint-[0-9a-f]{6}$/);
  });
});

describe('newImageServiceId', () => {
  it('符合 image-<名称简写>-<6 位十六进制>，同一个请求稳定', () => {
    expect(newImageServiceId('Studio', 'req-1')).toMatch(/^image-studio-[0-9a-f]{6}$/);
    expect(newImageServiceId('Studio', 'req-1')).toBe(newImageServiceId('Studio', 'req-1'));
  });
});
