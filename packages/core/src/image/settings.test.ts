import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { ImageCapabilities } from '@unwritten/contracts';
import type { Logger } from '../log/logger.ts';
import { openDatabase } from '../store/db.ts';
import { emptyProvidersFile } from '../providers/schema.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import {
  autoView,
  currentTarget,
  defaultIllustrationSettings,
  outputOptions,
  readIllustrationSettings,
  setAuto,
  setOutputPreferences,
  writeIllustrationSettings,
} from './settings.ts';

const background = { endpointId: 'custom-bg-000000', modelId: 'bg-model' };

function capabilities(overrides: Partial<ImageCapabilities> = {}): ImageCapabilities {
  return {
    maxReferences: 2,
    maxReferenceBytes: null,
    maxPromptLength: null,
    seed: true,
    negativePrompt: true,
    qualities: ['fast', 'best'],
    aspects: ['3:2'],
    resolutions: { '3:2': { '2k': { width: 3072, height: 2048 } } },
    ...overrides,
  };
}

function recordingLogger(): Logger & { events: Array<{ level: string; event: string }> } {
  const events: Array<{ level: string; event: string }> = [];
  return {
    events,
    record(entry) {
      events.push({ level: entry.level, event: entry.event });
    },
    sample() {},
    async flush() {},
    async close() {},
  };
}

describe('currentTarget', () => {
  const file = emptyProvidersFile();
  file.imageServices.push({
    id: 'image-a-000000',
    name: 'A',
    protocol: 'unwritten-image',
    baseUrl: 'https://image.example.test',
  });
  file.image.service = 'image-a-000000';
  const state = { status: 'ok' as const, revision: 'r', file, migratedFrom: null };

  it('没有选服务、服务不存在或没有 background 模型时返回 null', () => {
    const none = { ...state, file: { ...file, image: { service: null } } };
    expect(
      currentTarget(none, { resolve: () => ({ ...background, contextWindow: 1, maxOutputTokens: 1 }) }),
    ).toBeNull();
    expect(currentTarget(state, { resolve: () => null })).toBeNull();
  });

  it('unwritten-image 的 model 是 null，openai-images 用配置里的模型', () => {
    expect(currentTarget(state, { resolve: () => ({ ...background, contextWindow: 1, maxOutputTokens: 1 }) })).toEqual({
      serviceId: 'image-a-000000',
      model: null,
      background,
    });
    const openai = { ...state, file: structuredClone(file) };
    openai.file.imageServices = [
      {
        id: 'image-b-000000',
        name: 'B',
        protocol: 'openai-images',
        baseUrl: 'https://api.example.test',
        model: 'gpt-image-2',
        capabilities: { maxReferences: 16, sizes: 'custom' },
      },
    ];
    openai.file.image.service = 'image-b-000000';
    expect(currentTarget(openai, { resolve: () => ({ ...background, contextWindow: 1, maxOutputTokens: 1 }) })).toEqual(
      {
        serviceId: 'image-b-000000',
        model: 'gpt-image-2',
        background,
      },
    );
  });
});

describe('autoView 与 setAuto', () => {
  const current = {
    serviceId: 'image-a-000000',
    model: null,
    background,
  };

  it('未确认时关闭', () => {
    expect(autoView(defaultIllustrationSettings(), current).enabled).toBe(false);
  });

  it('确认与当前接收方一致时开启', () => {
    const settings = setAuto(defaultIllustrationSettings(), { enabled: true, confirm: current }, current);
    expect(settings.confirmed).toEqual(current);
    expect(autoView(settings, current).enabled).toBe(true);
  });

  it('接收方变了以后关闭，confirmed 仍是旧值', () => {
    const settings = setAuto(defaultIllustrationSettings(), { enabled: true, confirm: current }, current);
    const changed = { ...current, background: { endpointId: 'custom-bg-111111', modelId: 'other' } };
    const view = autoView(settings, changed);
    expect(view.enabled).toBe(false);
    expect(view.confirmed).toEqual(current);
  });

  it('确认的是旧接收方时拒绝', () => {
    const old = { ...current, background: { endpointId: 'custom-old-000000', modelId: 'old' } };
    expect(() => setAuto(defaultIllustrationSettings(), { enabled: true, confirm: old }, current)).toThrow(
      expect.objectContaining({ code: 'config_conflict' }),
    );
  });

  it('没有可用接收方时拒绝开启', () => {
    expect(() => setAuto(defaultIllustrationSettings(), { enabled: true, confirm: current }, null)).toThrow(
      expect.objectContaining({ code: 'image_not_configured' }),
    );
  });

  it('关闭时清掉确认', () => {
    const settings = setAuto(defaultIllustrationSettings(), { enabled: true, confirm: current }, current);
    const off = setAuto(settings, { enabled: false, confirm: null }, current);
    expect(off.autoEnabled).toBe(false);
    expect(off.confirmed).toBeNull();
  });
});

describe('outputOptions', () => {
  it('只列出有尺寸的档位，default 总在', () => {
    const view = outputOptions(defaultIllustrationSettings(), capabilities());
    expect(view.tiers.map((tier) => tier.tier)).toEqual(['2k', 'default']);
    expect(view.tiers[0]?.sizes).toEqual({ '3:2': { width: 3072, height: 2048 } });
  });

  it('固定比例加不可用档位时 preferenceAvailable 为 false', () => {
    const settings = setOutputPreferences(defaultIllustrationSettings(), {
      aspectPreference: '3:4',
      resolutionTier: '2k',
    });
    expect(outputOptions(settings, capabilities()).preferenceAvailable).toBe(false);
  });

  it('自动比例只要求某一个比例有该档', () => {
    const settings = setOutputPreferences(defaultIllustrationSettings(), {
      aspectPreference: 'auto',
      resolutionTier: '2k',
    });
    expect(outputOptions(settings, capabilities()).preferenceAvailable).toBe(true);
  });

  it('default 档总是可用', () => {
    const settings = setOutputPreferences(defaultIllustrationSettings(), {
      aspectPreference: 'auto',
      resolutionTier: 'default',
    });
    expect(outputOptions(settings, capabilities()).preferenceAvailable).toBe(true);
    expect(outputOptions(defaultIllustrationSettings(), null).tiers).toEqual([{ tier: 'default', sizes: {} }]);
  });
});

describe('读写 app_settings.illustration', () => {
  it('空库读出默认值，写入后读回同一份', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const logger = recordingLogger();
      expect(readIllustrationSettings(opened.db, logger)).toEqual(defaultIllustrationSettings());
      const written = writeIllustrationSettings(
        opened.db,
        setOutputPreferences(defaultIllustrationSettings(), {
          aspectPreference: '3:2',
          resolutionTier: '2k',
        }),
      );
      expect(readIllustrationSettings(opened.db, logger)).toEqual(written);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('不合格的已存配置当作默认值并记警告', () => {
    const temp = makeTempDataDir();
    const opened = openDatabase(join(temp.dir, 'library.db'));
    try {
      const logger = recordingLogger();
      const now = Date.now();
      opened.db.run(
        sql`insert into app_settings (id, appearance, illustration, updated_at)
            values (1, '{"appearance":"light","proseSize":"3","proseFont":"serif","proseLeading":"comfortable","proseLayout":"book","proseIndent":"2"}',
                    '{"autoEnabled":"yes"}', ${now})`,
      );
      expect(readIllustrationSettings(opened.db, logger)).toEqual(defaultIllustrationSettings());
      expect(logger.events).toContainEqual({ level: 'warn', event: 'image.settings.invalid' });
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
