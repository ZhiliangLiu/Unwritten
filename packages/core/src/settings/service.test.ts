import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, type CoreEvent } from '@unwritten/contracts';
import { createEventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase } from '../store/db.ts';
import { createSettingsService } from './service.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const bus = createEventBus();
  const service = createSettingsService({
    dataDir: temp.dir,
    db: opened.db,
    bus,
    logger,
    shutdown: new AbortController().signal,
  });
  return { temp, opened, bus, service };
}

describe('createSettingsService', () => {
  it('没有存过时返回默认偏好', () => {
    const { temp, opened, service } = setup();
    try {
      expect(service.get()).toEqual(DEFAULT_APPEARANCE);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('修改后读回新值并发出事件', async () => {
    const { temp, opened, bus, service } = setup();
    const events: CoreEvent[] = [];
    const abort = new AbortController();
    const collecting = (async () => {
      for await (const event of bus.subscribe(abort.signal)) events.push(event);
    })();
    try {
      const next = {
        appearance: 'dark' as const,
        proseSize: '4' as const,
        proseFont: 'sans' as const,
        proseLeading: 'compact' as const,
      };
      expect(service.update(next)).toEqual(next);
      expect(service.get()).toEqual(next);
      await new Promise((resolve) => setTimeout(resolve, 0));
      abort.abort();
      await collecting;
      expect(events).toEqual([{ type: 'settings.changed', appearance: next }]);
    } finally {
      abort.abort();
      opened.close();
      temp.cleanup();
    }
  });

  it('相同的值不发事件', async () => {
    const { temp, opened, bus, service } = setup();
    const events: CoreEvent[] = [];
    const abort = new AbortController();
    const collecting = (async () => {
      for await (const event of bus.subscribe(abort.signal)) events.push(event);
    })();
    try {
      const next = { ...DEFAULT_APPEARANCE, appearance: 'dark' as const };
      service.update(next);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events).toHaveLength(1);
      service.update(next);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events).toHaveLength(1);
      abort.abort();
      await collecting;
    } finally {
      abort.abort();
      opened.close();
      temp.cleanup();
    }
  });

  it('库里的值被改坏时回落到默认', () => {
    const { temp, opened, service } = setup();
    try {
      opened.db.run(
        sql`insert into app_settings (id, appearance, updated_at)
            values (1, '{"appearance":"purple"}', ${Date.now()})`,
      );
      expect(service.get()).toEqual(DEFAULT_APPEARANCE);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
