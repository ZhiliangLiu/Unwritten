import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OPENAI_IMAGE_DEFAULTS } from '@unwritten/contracts';
import type { CreateImageServiceInput, UpdateImageServiceInput } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { createProvidersStore } from '../providers/file.ts';
import { openDatabase } from '../store/db.ts';
import { createScriptedLlm } from '../test-support/scripted-llm.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createImageService } from './service.ts';

const requestId = '00000000-0000-4000-8000-000000000001';
const secondRequestId = '00000000-0000-4000-8000-000000000002';
const key = 'test-token-0123456789abcdef0123456789abcdef';

type Recorded = { level: string; event: string; data?: Record<string, unknown> };

function recordingLogger(events: Recorded[]): Logger {
  return {
    record(entry) {
      events.push({ level: entry.level, event: entry.event, data: entry.data });
    },
    sample() {},
    async flush() {},
    async close() {},
  };
}

function setup(options?: { env?: NodeJS.ProcessEnv; preload?: boolean }) {
  const { preload, ...runtime } = options ?? {};
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const bus = createEventBus();
  const events: Recorded[] = [];
  const logger = recordingLogger(events);
  const store = createProvidersStore(join(temp.dir, 'providers.json'));
  if (preload) store.load();
  const llm = createScriptedLlm();
  const service = createImageService(
    {
      dataDir: temp.dir,
      db: opened.db,
      bus,
      logger,
      shutdown: new AbortController().signal,
      providers: store,
      llm,
    },
    runtime,
  );
  return { temp, opened, bus, events, logger, store, llm, service, file: join(temp.dir, 'providers.json') };
}

function createInput(overrides: Partial<CreateImageServiceInput> = {}): CreateImageServiceInput {
  return {
    requestId,
    baseRevision: 'absent',
    name: '本机出图',
    protocol: 'unwritten-image',
    baseUrl: 'https://image.example.test',
    apiKey: key,
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

describe('createImageService', () => {
  it('新建服务后列表里只有 key 状态，同一 requestId 复用 id', async () => {
    const { temp, opened, service } = setup();
    try {
      const created = await service.createService(createInput());
      expect(created.serviceId).toMatch(/^image-[a-z0-9-]+-[0-9a-f]{6}$/u);
      const view = service.listServices();
      expect(view.status).toBe('ok');
      expect(view.services).toHaveLength(1);
      expect(view.services[0]?.key).toEqual({ hasKey: true, source: 'file', envVar: null });
      expect(JSON.stringify(view)).not.toContain(key);

      const second = await service.createService({ ...createInput(), baseRevision: created.config.revision });
      expect(second.serviceId).toBe(created.serviceId);
      expect(service.listServices().services).toHaveLength(1);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('$ENV 写法的 key 报告环境变量来源', async () => {
    const { temp, opened, service } = setup({ env: { TEST_IMAGE_KEY: 'from-env' } });
    try {
      await service.createService(createInput({ apiKey: '$TEST_IMAGE_KEY' }));
      expect(service.listServices().services[0]?.key).toEqual({
        hasKey: true,
        source: 'env',
        envVar: 'TEST_IMAGE_KEY',
      });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('过期的 baseRevision 抛 config_conflict 且文件不变', async () => {
    const { temp, opened, service, file } = setup();
    try {
      await service.createService(createInput());
      const before = readFileSync(file, 'utf8');
      await expect(
        service.createService(createInput({ requestId: secondRequestId, name: '第二个', baseRevision: 'absent' })),
      ).rejects.toMatchObject({ code: 'config_conflict' });
      expect(readFileSync(file, 'utf8')).toBe(before);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('删除选中的服务时清空 image.service', async () => {
    const { temp, opened, service, store } = setup();
    try {
      const created = await service.createService(createInput());
      const selected = await service.select({
        baseRevision: created.config.revision,
        serviceId: created.serviceId,
      });
      expect(selected.selectedServiceId).toBe(created.serviceId);
      const removed = await service.removeService({
        baseRevision: selected.revision,
        serviceId: created.serviceId,
      });
      expect(removed.selectedServiceId).toBeNull();
      const state = store.load();
      expect(state.status === 'ok' && state.file.image.service).toBeNull();
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('openai-images 不能带启动器，启动器换地址要先移除', async () => {
    const { temp, opened, service } = setup();
    try {
      await expect(
        service.createService(
          createInput({
            requestId: secondRequestId,
            name: 'OpenAI',
            protocol: 'openai-images',
            model: 'gpt-image-2',
            launcher: { baseUrl: 'http://127.0.0.1:8290', apiKey: null },
          }),
        ),
      ).rejects.toMatchObject({ code: 'invalid_input' });

      const created = await service.createService(
        createInput({ launcher: { baseUrl: 'http://127.0.0.1:8290', apiKey: null }, idleMinutes: 30 }),
      );
      await expect(
        service.updateService(
          updateInput({
            baseRevision: created.config.revision,
            serviceId: created.serviceId,
            launcher: { action: 'set', baseUrl: 'http://127.0.0.1:9999', apiKey: null },
          }),
        ),
      ).rejects.toMatchObject({ code: 'invalid_input' });

      const removed = await service.updateService(
        updateInput({
          baseRevision: created.config.revision,
          serviceId: created.serviceId,
          launcher: { action: 'remove' },
        }),
      );
      const reset = await service.updateService(
        updateInput({
          baseRevision: removed.revision,
          serviceId: created.serviceId,
          launcher: { action: 'set', baseUrl: 'http://127.0.0.1:9999', apiKey: null },
        }),
      );
      expect(reset.services[0]?.launcher?.baseUrl).toBe('http://127.0.0.1:9999');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('未提交 OpenAI 能力时保留同模型的自定义能力，换模型才重新预填', async () => {
    const { temp, opened, service } = setup();
    try {
      const created = await service.createService(
        createInput({
          protocol: 'openai-images',
          model: 'gpt-image-2',
          openai: { maxReferences: 4, sizes: 'fixed', outputFormat: 'jpeg' },
        }),
      );
      expect(created.config.services[0]?.openai).toEqual({
        ...OPENAI_IMAGE_DEFAULTS,
        maxReferences: 4,
        sizes: 'fixed',
        outputFormat: 'jpeg',
      });

      const kept = await service.updateService(
        updateInput({
          baseRevision: created.config.revision,
          serviceId: created.serviceId,
          name: '改名',
          model: 'gpt-image-2',
          openai: null,
        }),
      );
      expect(kept.services[0]?.openai).toEqual({
        ...OPENAI_IMAGE_DEFAULTS,
        maxReferences: 4,
        sizes: 'fixed',
        outputFormat: 'jpeg',
      });

      const explicit = await service.updateService(
        updateInput({
          baseRevision: kept.revision,
          serviceId: created.serviceId,
          model: 'gpt-image-2',
          openai: { maxReferences: 2, sizes: 'custom' },
        }),
      );
      expect(explicit.services[0]?.openai).toEqual({
        ...OPENAI_IMAGE_DEFAULTS,
        maxReferences: 2,
        sizes: 'custom',
      });

      const changed = await service.updateService(
        updateInput({
          baseRevision: explicit.revision,
          serviceId: created.serviceId,
          model: 'gpt-image-1.5',
          openai: null,
        }),
      );
      expect(changed.services[0]?.openai).toEqual({
        ...OPENAI_IMAGE_DEFAULTS,
        maxReferences: 16,
        sizes: 'fixed',
      });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('共享存储已加载时，启动仍记 image.config.loaded，第一次配置变化就发布', async () => {
    const { temp, opened, bus, events, service } = setup({ preload: true });
    const publish = vi.spyOn(bus, 'publish');
    try {
      expect(events.filter((entry) => entry.event === 'image.config.loaded')).toHaveLength(1);
      expect(events).toContainEqual({
        level: 'info',
        event: 'image.config.loaded',
        data: { services: 0, selected: false },
      });
      const imageEvents = () => publish.mock.calls.filter(([event]) => event.type === 'image.config_changed').length;
      expect(imageEvents()).toBe(0);

      const created = await service.createService(createInput());
      expect(imageEvents()).toBe(1);

      await service.select({ baseRevision: created.config.revision, serviceId: created.serviceId });
      expect(imageEvents()).toBe(2);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('只有出图配置变化才发布 image.config_changed', async () => {
    const { temp, opened, bus, service, store } = setup();
    const publish = vi.spyOn(bus, 'publish');
    try {
      await service.createService(createInput());
      const imageEvents = () => publish.mock.calls.filter(([event]) => event.type === 'image.config_changed').length;
      expect(imageEvents()).toBe(1);

      const state = store.load();
      if (state.status !== 'ok') throw new Error('providers.json should be readable');
      const file = structuredClone(state.file);
      file.purposes.default = { provider: 'custom-bg-000000', model: 'bg' };
      store.write(file);
      expect(imageEvents()).toBe(1);

      const current = store.load();
      await service.createService({
        ...createInput({ requestId: secondRequestId, name: '第二个' }),
        baseRevision: current.revision,
      });
      expect(imageEvents()).toBe(2);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('版本 1 文件第一次写入时备份为 .bak 并升到版本 2', async () => {
    const { temp, opened, service, file } = setup();
    try {
      const versionOne = {
        version: 1,
        providers: {},
        endpoints: [],
        purposes: {},
      };
      writeFileSync(file, `${JSON.stringify(versionOne, null, 2)}\n`);
      const revision = service.listServices().revision;
      await service.createService(createInput({ baseRevision: revision }));
      expect(existsSync(`${file}.bak`)).toBe(true);
      expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('默认规格和自动出图的读写', async () => {
    const { temp, opened, service, events } = setup();
    try {
      expect(service.getOutputOptions().preferences).toEqual({ aspectPreference: 'auto', resolutionTier: '1k' });
      const options = service.setOutputPreferences({ aspectPreference: '3:2', resolutionTier: '2k' });
      expect(options.preferences).toEqual({ aspectPreference: '3:2', resolutionTier: '2k' });

      const created = await service.createService(createInput());
      await service.select({ baseRevision: created.config.revision, serviceId: created.serviceId });
      const initial = service.getAutoIllustration();
      expect(initial.enabled).toBe(false);
      expect(initial.current).toMatchObject({ serviceId: created.serviceId, model: null });
      const enabled = service.setAutoIllustration({ enabled: true, confirm: initial.current });
      expect(enabled.enabled).toBe(true);
      expect(service.activeTarget()).toEqual(initial.current);
      expect(events).toContainEqual({
        level: 'info',
        event: 'image.auto_illustration.set',
        data: { enabled: true },
      });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
