import { describe, expect, it } from 'vitest';
import { newEndpointId } from './endpoint-id.ts';

describe('newEndpointId', () => {
  it('同一个 requestId 得到同一个 id', () => {
    expect(newEndpointId('Ollama', 'req-1')).toBe(newEndpointId('Ollama', 'req-1'));
  });

  it('中文名回落到 endpoint，并符合格式', () => {
    const id = newEndpointId('本机模型', 'req-1');
    expect(id).toMatch(/^custom-endpoint-[0-9a-f]{6}$/);
  });
});
