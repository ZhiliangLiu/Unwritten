import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../events/bus.ts';
import type { Logger } from '../log/logger.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { openDatabase } from '../store/db.ts';
import { createLibraryService, workLabel } from './service.ts';

const logger: Logger = {
  record() {},
  sample() {},
  async flush() {},
  async close() {},
};

const workId = '00000000-0000-4000-8000-000000000001';

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  const service = createLibraryService({
    dataDir: temp.dir,
    db: opened.db,
    bus: createEventBus(),
    logger,
    shutdown: new AbortController().signal,
  });
  return { temp, opened, service };
}

describe('workLabel', () => {
  it('有标题用标题，没有标题取背景第一行', () => {
    expect(workLabel('雨夜', '背景')).toBe('雨夜');
    expect(workLabel(null, '\n  第一行  \n第二行')).toBe('第一行');
    expect(workLabel(null, '')).toBe('');
    expect(Array.from(workLabel(null, '一'.repeat(50)))).toHaveLength(40);
  });
});

describe('createLibraryService', () => {
  it('新建草稿、保存背景并区分修订号', () => {
    const { temp, opened, service } = setup();
    try {
      const created = service.create({ workId });
      expect(created.draft).toEqual({ contentRev: 0, background: '' });
      const saved = service.saveBackground({ workId, baseContentRev: 0, background: '雨夜修钟铺' });
      expect(saved.contentRev).toBe(1);
      expect(service.get({ workId }).draft.background).toBe('雨夜修钟铺');
      expect(service.saveBackground({ workId, baseContentRev: 1, background: '雨夜修钟铺' }).contentRev).toBe(1);
      expect(() => service.saveBackground({ workId, baseContentRev: 0, background: '另一个' })).toThrow();
      expect(service.saveBackground({ workId, baseContentRev: 1, background: '另一个' }).contentRev).toBe(2);
      expect(service.create({ workId }).draft.contentRev).toBe(2);
    } finally {
      opened.close();
      temp.cleanup();
    }
  });

  it('列表按更新时间倒序，未发布为草稿', () => {
    const { temp, opened, service } = setup();
    try {
      const first = '00000000-0000-4000-8000-000000000001';
      const second = '00000000-0000-4000-8000-000000000002';
      service.create({ workId: first });
      service.create({ workId: second });
      service.saveBackground({ workId: second, baseContentRev: 0, background: '第二部' });
      const list = service.list();
      expect(list[0]?.id).toBe(second);
      expect(list[0]?.status).toBe('draft');
      expect(list[0]?.label).toBe('第二部');
    } finally {
      opened.close();
      temp.cleanup();
    }
  });
});
