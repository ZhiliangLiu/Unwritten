import { describe, expect, it } from 'vitest';
import type { CreateImageServiceInput, UpdateImageServiceInput } from '@unwritten/contracts';
import { applyUpdate, createEntry, serviceView, UNKNOWN_WAKE_VIEW, validateBaseUrl } from './config.ts';
import { createCapabilityCache } from './capability-cache.ts';

const requestId = '00000000-0000-4000-8000-000000000001';

function createInput(overrides: Partial<CreateImageServiceInput> = {}): CreateImageServiceInput {
  return {
    requestId,
    baseRevision: 'absent',
    name: '本机出图',
    protocol: 'unwritten-image',
    baseUrl: 'https://image.example.test/',
    apiKey: 'test-token-0123456789abcdef0123456789abcdef',
    model: null,
    openai: null,
    launcher: null,
    idleMinutes: null,
    ...overrides,
  };
}

function updateInput(overrides: Partial<UpdateImageServiceInput> = {}): UpdateImageServiceInput {
  return {
    baseRevision: 'absent',
    serviceId: 'image-x',
    name: '本机出图',
    key: { action: 'keep' },
    model: null,
    openai: null,
    launcher: { action: 'keep', key: { action: 'keep' } },
    idleMinutes: 30,
    ...overrides,
  };
}

describe('validateBaseUrl', () => {
  it('规范化地址并拒绝非法地址', () => {
    expect(validateBaseUrl('https://image.example.test/')).toBe('https://image.example.test');
    expect(() => validateBaseUrl('ftp://image.example.test')).toThrow(expect.objectContaining({ code: 'invalid_url' }));
  });
});

describe('serviceView', () => {
  it('返回 key 状态而不返回 key 原文', () => {
    const entry = createEntry(createInput());
    const view = serviceView(entry, {}, null, UNKNOWN_WAKE_VIEW, null);
    expect(view.key).toEqual({ hasKey: true, source: 'file', envVar: null });
    expect(JSON.stringify(view)).not.toContain('test-token-0123456789abcdef0123456789abcdef');
  });

  it('$ENV 写法报告环境变量来源', () => {
    const entry = createEntry(createInput({ apiKey: '$TEST_IMAGE_KEY' }));
    const view = serviceView(entry, { TEST_IMAGE_KEY: 'secret' }, null, UNKNOWN_WAKE_VIEW, null);
    expect(view.key).toEqual({ hasKey: true, source: 'env', envVar: 'TEST_IMAGE_KEY' });
  });

  it('没有 launcher 时 idleMinutes 用默认值', () => {
    const entry = createEntry(createInput({ idleMinutes: 90 }));
    expect(serviceView(entry, {}, null, UNKNOWN_WAKE_VIEW, null).idleMinutes).toBe(30);
  });

  it('openai-images 的能力从配置预填', () => {
    const entry = createEntry(createInput({ protocol: 'openai-images', model: 'gpt-image-2' }));
    const view = serviceView(entry, {}, null, UNKNOWN_WAKE_VIEW, 1234);
    expect(view.capabilities?.maxReferences).toBe(16);
    expect(view.capabilities?.aspects).toEqual(['1:1', '3:2', '2:3', '3:4', '4:3', '16:9', '9:16']);
    expect(view.openai).toEqual({ maxReferences: 16, sizes: 'custom' });
    expect(view.lastSuccessAt).toBe(1234);
  });

  it('unwritten-image 的能力取探测缓存', () => {
    const entry = createEntry(createInput());
    const cache = createCapabilityCache();
    const capabilities = {
      maxReferences: 1,
      maxReferenceBytes: null,
      maxPromptLength: null,
      seed: true,
      negativePrompt: true,
      qualities: ['fast' as const],
      aspects: ['1:1'],
      resolutions: { '1:1': { '1k': { width: 1024, height: 1024 } } },
    };
    cache.set(entry.id, {
      at: 10,
      result: 'ready',
      notReadyReason: null,
      implementation: { name: '伪服务', version: '1' },
      model: null,
      capabilities,
    });
    const view = serviceView(entry, {}, cache.get(entry.id), UNKNOWN_WAKE_VIEW, null);
    expect(view.capabilities).toEqual(capabilities);
    expect(view.openai).toBeNull();
    expect(view.probe?.implementation).toEqual({ name: '伪服务', version: '1' });
  });
});

describe('createEntry', () => {
  it('id 格式是 image-<名称简写>-<六位十六进制>', () => {
    const entry = createEntry(createInput());
    expect(entry.id).toMatch(/^image-[a-z0-9-]+-[0-9a-f]{6}$/u);
  });

  it('openai-images 必须填模型', () => {
    expect(() => createEntry(createInput({ protocol: 'openai-images' }))).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    );
  });

  it('openai-images 不能带启动器', () => {
    expect(() =>
      createEntry(
        createInput({
          protocol: 'openai-images',
          model: 'gpt-image-2',
          launcher: { baseUrl: 'http://127.0.0.1:8290', apiKey: null },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });

  it('unwritten-image 忽略模型和 openai 选项', () => {
    const entry = createEntry(createInput({ model: 'ignored', openai: { maxReferences: 3, sizes: 'fixed' } }));
    expect(entry.model).toBeUndefined();
    expect(entry.capabilities).toBeUndefined();
  });

  it('idleMinutes 只在有启动器时写入', () => {
    const entry = createEntry(
      createInput({ launcher: { baseUrl: 'http://127.0.0.1:8290', apiKey: null }, idleMinutes: null }),
    );
    expect(entry.launcher).toEqual({ baseUrl: 'http://127.0.0.1:8290' });
    expect(entry.idleMinutes).toBe(30);
  });
});

describe('applyUpdate', () => {
  it('服务 key 的三种动作', () => {
    const entry = createEntry(createInput());
    expect(applyUpdate(entry, updateInput()).apiKey).toBe(entry.apiKey);
    expect(applyUpdate(entry, updateInput({ key: { action: 'set', value: 'new' } })).apiKey).toBe('new');
    expect(applyUpdate(entry, updateInput({ key: { action: 'remove' } })).apiKey).toBeUndefined();
  });

  it('启动器换成另一个地址被拒绝，先移除再设置可以', () => {
    const entry = createEntry(createInput({ launcher: { baseUrl: 'http://127.0.0.1:8290', apiKey: 'launcher-key' } }));
    expect(() =>
      applyUpdate(
        entry,
        updateInput({
          launcher: { action: 'set', baseUrl: 'http://127.0.0.1:9999', apiKey: null },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }));

    const removed = applyUpdate(entry, updateInput({ launcher: { action: 'remove' } }));
    expect(removed.launcher).toBeUndefined();
    expect(removed.idleMinutes).toBeUndefined();
    const reset = applyUpdate(
      removed,
      updateInput({ launcher: { action: 'set', baseUrl: 'http://127.0.0.1:9999', apiKey: null } }),
    );
    expect(reset.launcher).toEqual({ baseUrl: 'http://127.0.0.1:9999' });
  });

  it('启动器 key 沿用 keep 动作', () => {
    const entry = createEntry(createInput({ launcher: { baseUrl: 'http://127.0.0.1:8290', apiKey: 'launcher-key' } }));
    expect(applyUpdate(entry, updateInput()).launcher?.apiKey).toBe('launcher-key');
    expect(
      applyUpdate(entry, updateInput({ launcher: { action: 'keep', key: { action: 'remove' } } })).launcher?.apiKey,
    ).toBeUndefined();
  });

  it('openai-images 不接受设置启动器', () => {
    const entry = createEntry(createInput({ protocol: 'openai-images', model: 'gpt-image-2' }));
    expect(() =>
      applyUpdate(
        entry,
        updateInput({
          model: 'gpt-image-2',
          launcher: { action: 'set', baseUrl: 'http://127.0.0.1:8290', apiKey: null },
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });

  it('openai-images 改模型时重新预填能力', () => {
    const entry = createEntry(createInput({ protocol: 'openai-images', model: 'gpt-image-2' }));
    const updated = applyUpdate(
      entry,
      updateInput({ model: 'gpt-image-1.5', openai: null, launcher: { action: 'keep', key: { action: 'keep' } } }),
    );
    expect(updated.model).toBe('gpt-image-1.5');
    expect(updated.capabilities).toEqual({ maxReferences: 16, sizes: 'fixed' });
  });
});
