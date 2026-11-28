import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/db.ts';
import { imageCalls } from '../store/schema.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import {
  IMAGE_CALL_RETENTION_DAYS,
  lastSuccessAt,
  pruneCalls,
  recordCall,
  usageSummary,
  type ImageCallRecord,
} from './calls.ts';

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;

function setup() {
  const temp = makeTempDataDir();
  const opened = openDatabase(join(temp.dir, 'library.db'));
  return { opened, close: () => (opened.close(), temp.cleanup()) };
}

function call(overrides: Partial<ImageCallRecord> = {}): ImageCallRecord {
  return {
    serviceId: 'image-a-000001',
    protocol: 'unwritten-image',
    model: null,
    workId: null,
    refKind: 'illustration',
    refId: null,
    quality: 'best',
    referenceCount: 0,
    inputTokens: null,
    outputTokens: null,
    durationMs: 10,
    status: 'ok',
    error: null,
    createdAt: NOW,
    ...overrides,
  };
}

describe('image calls', () => {
  it('7 天和 30 天的窗口按边界分别累计张数与 token', () => {
    const { opened, close } = setup();
    try {
      recordCall(opened.db, call({ createdAt: NOW - 7 * DAY_MS }));
      recordCall(opened.db, call({ createdAt: NOW - 7 * DAY_MS - 1, inputTokens: 5, outputTokens: 7 }));
      recordCall(opened.db, call({ createdAt: NOW - 30 * DAY_MS, status: 'error', error: 'image_server' }));
      recordCall(opened.db, call({ createdAt: NOW - 30 * DAY_MS - 1 }));

      const summary = usageSummary(opened.db, [{ id: 'image-a-000001', name: 'A' }], NOW);
      expect(summary.services).toHaveLength(1);
      expect(summary.services[0]).toEqual({
        serviceId: 'image-a-000001',
        name: 'A',
        last7Days: { images: 1, inputTokens: 0, outputTokens: 0 },
        last30Days: { images: 2, inputTokens: 5, outputTokens: 7 },
      });
    } finally {
      close();
    }
  });

  it('已删除的服务 name 为空，其他服务的名字照常返回', () => {
    const { opened, close } = setup();
    try {
      recordCall(opened.db, call({ serviceId: 'image-gone-000001' }));
      recordCall(opened.db, call({ serviceId: 'image-here-000001' }));
      const summary = usageSummary(opened.db, [{ id: 'image-here-000001', name: '还在' }], NOW);
      expect(summary.services).toEqual([
        expect.objectContaining({ serviceId: 'image-gone-000001', name: null }),
        expect.objectContaining({ serviceId: 'image-here-000001', name: '还在' }),
      ]);
    } finally {
      close();
    }
  });

  it('清理只删 90 天以前的行', () => {
    const { opened, close } = setup();
    try {
      recordCall(opened.db, call({ createdAt: NOW - IMAGE_CALL_RETENTION_DAYS * DAY_MS - 1 }));
      recordCall(opened.db, call({ createdAt: NOW - IMAGE_CALL_RETENTION_DAYS * DAY_MS }));
      expect(pruneCalls(opened.db, NOW)).toBe(1);
      expect(pruneCalls(opened.db, NOW)).toBe(0);
      const rows = opened.db.select().from(imageCalls).all();
      expect(rows).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('最近一次成功时间只取 ok 的行', () => {
    const { opened, close } = setup();
    try {
      recordCall(opened.db, call({ createdAt: NOW - 1000 }));
      recordCall(opened.db, call({ createdAt: NOW - 500, status: 'error', error: 'image_server' }));
      recordCall(opened.db, call({ serviceId: 'image-b-000001', status: 'error', error: 'image_offline' }));
      const successes = lastSuccessAt(opened.db);
      expect(successes.get('image-a-000001')).toBe(NOW - 1000);
      expect(successes.has('image-b-000001')).toBe(false);
    } finally {
      close();
    }
  });
});
