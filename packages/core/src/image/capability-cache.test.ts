import { describe, expect, it } from 'vitest';
import type { ImageCapabilities } from '@unwritten/contracts';
import { createCapabilityCache } from './capability-cache.ts';

function record(at: number, capabilities: ImageCapabilities | null) {
  return {
    at,
    result: 'ready' as const,
    notReadyReason: null,
    implementation: { name: '伪服务', version: '1.0.0' },
    model: 'm',
    capabilities,
  };
}

describe('createCapabilityCache', () => {
  it('按服务 id 读写和删除', () => {
    const cache = createCapabilityCache();
    expect(cache.get('a')).toBeNull();
    const capabilities: ImageCapabilities = {
      maxReferences: 0,
      maxReferenceBytes: null,
      maxPromptLength: null,
      seed: false,
      negativePrompt: false,
      qualities: ['fast'],
      aspects: ['1:1'],
      resolutions: { '1:1': { '1k': { width: 1024, height: 1024 } } },
    };
    cache.set('a', record(1, capabilities));
    expect(cache.get('a')?.capabilities).toEqual(capabilities);
    cache.delete('a');
    expect(cache.get('a')).toBeNull();
  });

  it('同一个 id 后写覆盖前写', () => {
    const cache = createCapabilityCache();
    cache.set('a', record(1, null));
    cache.set('a', { ...record(2, null), result: 'offline' });
    expect(cache.get('a')).toMatchObject({ at: 2, result: 'offline' });
  });
});
