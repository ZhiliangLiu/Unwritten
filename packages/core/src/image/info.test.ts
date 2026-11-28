import { describe, expect, it } from 'vitest';
import { parseServiceInfo } from './info.ts';

function validInfo() {
  return {
    protocol: 'unwritten-image/1',
    implementation: { name: 'Fake', version: '0.0.0' },
    model: 'fake-model',
    ready: true,
    notReadyReason: null,
    capabilities: {
      maxReferences: 4,
      maxReferenceBytes: 8 * 1024 * 1024,
      maxPromptLength: 4000,
      seed: true,
      negativePrompt: false,
      qualities: ['fast', 'best'],
      aspects: ['1:1', '3:2', '3:4'],
      resolutions: {
        '1:1': {
          '720': { width: 720, height: 720 },
          '1k': { width: 1024, height: 1024 },
          '2k': { width: 2048, height: 2048 },
        },
        '3:2': {
          '720': { width: 1088, height: 720 },
          '1k': { width: 1536, height: 1024 },
        },
        '3:4': {
          '720': { width: 720, height: 960 },
          '1k': { width: 1024, height: 1360 },
        },
      },
    },
  };
}

function omit<T extends Record<string, unknown>>(record: T, key: string): T {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

describe('parseServiceInfo', () => {
  it('解析完整的能力', () => {
    const result = parseServiceInfo(validInfo());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.model).toBe('fake-model');
    expect(result.info.ready).toBe(true);
    expect(result.info.capabilities.maxReferences).toBe(4);
    expect(result.info.capabilities.qualities).toEqual(['fast', 'best']);
    expect(result.info.capabilities.resolutions['3:2']).toEqual({
      '720': { width: 1088, height: 720 },
      '1k': { width: 1536, height: 1024 },
    });
  });

  it('缺少 3:4 比例时拒绝', () => {
    const raw = validInfo();
    raw.capabilities.aspects = ['1:1', '3:2'];
    raw.capabilities.resolutions = omit(raw.capabilities.resolutions, '3:4');
    expect(parseServiceInfo(raw).ok).toBe(false);
  });

  it('比例不是互质时拒绝', () => {
    const raw = validInfo();
    raw.capabilities.aspects = ['1:1', '3:2', '6:4', '3:4'];
    expect(parseServiceInfo(raw).ok).toBe(false);
  });

  it('比例重复时拒绝', () => {
    const raw = validInfo();
    raw.capabilities.aspects = ['1:1', '3:2', '3:4', '3:2'];
    expect(parseServiceInfo(raw).ok).toBe(false);
  });

  it('1k 档位的短边偏离目标时拒绝', () => {
    const raw = validInfo();
    raw.capabilities.resolutions['1:1']['1k'] = { width: 1100, height: 1100 };
    expect(parseServiceInfo(raw).ok).toBe(false);
  });

  it('档位的总像素不严格递增时拒绝', () => {
    const raw = validInfo();
    raw.capabilities.resolutions['1:1']['2k'] = { width: 1024, height: 1024 };
    expect(parseServiceInfo(raw).ok).toBe(false);
  });

  it('协议版本不同时拒绝', () => {
    const raw = validInfo();
    raw.protocol = 'unwritten-image/2';
    expect(parseServiceInfo(raw).ok).toBe(false);
  });

  it('只报告 aspects 的老服务解析为 ok，resolutions 为空对象', () => {
    const raw = validInfo();
    (raw.capabilities as { resolutions?: unknown }).resolutions = undefined;
    const result = parseServiceInfo(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.capabilities.resolutions).toEqual({});
  });

  it('忽略不认识的档位键', () => {
    const raw = validInfo();
    (raw.capabilities.resolutions['1:1'] as Record<string, { width: number; height: number }>)['4k'] = {
      width: 4096,
      height: 4096,
    };
    const result = parseServiceInfo(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.capabilities.resolutions['1:1']).toEqual({
      '720': { width: 720, height: 720 },
      '1k': { width: 1024, height: 1024 },
      '2k': { width: 2048, height: 2048 },
    });
  });

  it('忽略不认识的顶层和能力字段', () => {
    const raw = validInfo();
    const withExtras = {
      ...raw,
      queue: { pending: 0, max: 8 },
      capabilities: { ...raw.capabilities, mystery: true },
    };
    const result = parseServiceInfo(withExtras);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.capabilities).not.toHaveProperty('mystery');
  });

  it('model 缺省时为 null', () => {
    const raw = validInfo();
    (raw as { model?: string }).model = undefined;
    const result = parseServiceInfo(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.model).toBeNull();
  });
});
