import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { createLogger } from './logger.ts';

function readRows(dir: string, table: 'diagnostic_events' | 'performance_samples'): Record<string, unknown>[] {
  const db = new DatabaseSync(join(dir, 'diagnostics.db'));
  try {
    return db.prepare(`select * from ${table}`).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

async function waitUntil(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('createLogger', () => {
  it('入队后自行落库，不需要显式 flush', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    logger.record({ level: 'info', module: 'core', event: 'core.started' });
    logger.sample({ metric: 'core.startup', durationMs: 1, outcome: 'ok' });
    await waitUntil(() => readRows(temp.dir, 'performance_samples').length > 0);
    const events = readRows(temp.dir, 'diagnostic_events');
    const samples = readRows(temp.dir, 'performance_samples');
    await logger.close();
    temp.cleanup();

    expect(events.map((row) => row.event)).toEqual(['core.started']);
    expect(samples.map((row) => row.metric)).toEqual(['core.startup']);
  });

  it('关闭之后不再重新打开诊断库', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    logger.record({ level: 'info', module: 'core', event: 'before-close' });
    await logger.close();
    logger.record({ level: 'info', module: 'core', event: 'after-close' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const events = readRows(temp.dir, 'diagnostic_events');
    temp.cleanup();

    expect(events.map((row) => row.event)).toEqual(['before-close']);
  });

  it('写入运行事件和性能样本', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    logger.record({ level: 'info', module: 'core', event: 'core.started', data: { port: 4317 } });
    logger.sample({ metric: 'core.startup', durationMs: 12.5, outcome: 'ok' });
    await logger.flush();
    const events = readRows(temp.dir, 'diagnostic_events');
    const samples = readRows(temp.dir, 'performance_samples');
    await logger.close();
    temp.cleanup();

    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('core.started');
    expect(JSON.parse(String(events[0]?.data))).toEqual({ port: 4317 });
    expect(samples).toHaveLength(1);
    expect(samples[0]?.metric).toBe('core.startup');
    expect(samples[0]?.app_version).toBe('1.0.0');
  });

  it('按级别过滤运行事件', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'warn', appVersion: '1.0.0' });
    logger.record({ level: 'info', module: 'core', event: 'ignored' });
    logger.record({ level: 'error', module: 'core', event: 'kept' });
    await logger.flush();
    const events = readRows(temp.dir, 'diagnostic_events');
    await logger.close();
    temp.cleanup();
    expect(events.map((row) => row.event)).toEqual(['kept']);
  });

  it('删除超过保留期的记录，并保留新记录', async () => {
    const temp = makeTempDataDir();
    await createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' }).close();
    const db = new DatabaseSync(join(temp.dir, 'diagnostics.db'));
    const old = Date.now() - 15 * 86_400_000;
    db.prepare(
      `insert into diagnostic_events (id, created_at, run_id, level, module, event, data)
       values ('old', ?, 'run', 'info', 'core', 'old', '{}')`,
    ).run(old);
    db.close();

    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    logger.record({ level: 'info', module: 'core', event: 'new' });
    await logger.flush();
    const events = readRows(temp.dir, 'diagnostic_events');
    await logger.close();
    temp.cleanup();
    expect(events.map((row) => row.event)).toEqual(['new']);
  });

  it('队列满时丢弃新记录并写一条计数事件', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    for (let index = 0; index < 1_100; index += 1) {
      logger.record({ level: 'info', module: 'core', event: `event-${index}` });
    }
    await logger.flush();
    const events = readRows(temp.dir, 'diagnostic_events');
    await logger.close();
    temp.cleanup();
    expect(events).toHaveLength(1_025);
    const dropped = events.find((row) => row.event === 'diagnostics.dropped');
    expect(dropped).toBeDefined();
    expect(JSON.parse(String(dropped?.data))).toEqual({ count: 76 });
  });

  it('写入故障后丢弃该批，恢复后继续写入', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    const blocker = new DatabaseSync(join(temp.dir, 'diagnostics.db'));
    blocker.exec('BEGIN IMMEDIATE');
    logger.record({ level: 'info', module: 'core', event: 'lost' });
    await logger.flush();
    blocker.exec('COMMIT');
    blocker.close();
    logger.record({ level: 'info', module: 'core', event: 'recovered' });
    await logger.flush();
    const events = readRows(temp.dir, 'diagnostic_events');
    await logger.close();
    temp.cleanup();
    expect(events.map((row) => row.event)).toContain('recovered');
    expect(events.map((row) => row.event)).not.toContain('lost');
  });

  it('首批写入被锁时，剩余记录在锁解除后自行落库', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    const blocker = new DatabaseSync(join(temp.dir, 'diagnostics.db'));
    try {
      blocker.exec('BEGIN IMMEDIATE');
      for (let index = 0; index < 128; index += 1) {
        logger.record({ level: 'info', module: 'core', event: 'lost' });
      }
      logger.record({ level: 'info', module: 'core', event: 'next-batch' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      blocker.exec('COMMIT');
      await new Promise<void>((resolve) => setImmediate(resolve));
      const rows = readRows(temp.dir, 'diagnostic_events');
      expect(rows.map((row) => row.event)).toEqual(['next-batch', 'diagnostics.dropped']);
      expect(JSON.parse(String(rows[1]?.data))).toEqual({ count: 128 });
    } finally {
      blocker.close();
      await logger.close();
      temp.cleanup();
    }
  });

  it('有读事务时仍能写入', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    const reader = new DatabaseSync(join(temp.dir, 'diagnostics.db'));
    reader.exec('BEGIN');
    reader.prepare('select count(*) as count from diagnostic_events').get();
    logger.record({ level: 'info', module: 'core', event: 'while-reading' });
    await logger.flush();
    reader.exec('COMMIT');
    reader.close();
    const events = readRows(temp.dir, 'diagnostic_events');
    await logger.close();
    temp.cleanup();
    expect(events.map((row) => row.event)).toEqual(['while-reading']);
  });

  it('按批次写入，余下记录在后续批次提交', async () => {
    const temp = makeTempDataDir();
    let scheduled = 0;
    const logger = createLogger({
      dataDir: temp.dir,
      level: 'info',
      appVersion: '1.0.0',
      schedule: (callback) => {
        scheduled += 1;
        setImmediate(callback);
      },
    });
    for (let index = 0; index < 200; index += 1) {
      logger.record({ level: 'info', module: 'core', event: `batch-${index}` });
    }
    await logger.flush();
    const events = readRows(temp.dir, 'diagnostic_events');
    await logger.close();
    temp.cleanup();
    const enqueueSchedule = 1;
    const batchYields = 2;
    expect(events).toHaveLength(200);
    expect(scheduled).toBe(enqueueSchedule + batchYields);
  });

  it('不写入凭据和自由文本以外的敏感字段', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    logger.record({
      level: 'info',
      module: 'core',
      event: 'probe',
      data: { apiKey: 'sk-very-secret-value', message: '不应入库', count: 2 },
    });
    await logger.flush();
    const events = readRows(temp.dir, 'diagnostic_events');
    await logger.close();
    temp.cleanup();
    const encoded = JSON.stringify(events);
    expect(encoded).not.toContain('sk-very-secret-value');
    expect(encoded).not.toContain('不应入库');
    expect(JSON.parse(String(events[0]?.data))).toEqual({ count: 2 });
  });

  it('上一轮 flush 尚未完成时，新 flush 也等待它前面入队的记录', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    try {
      const first = logger.flush();
      logger.record({ level: 'info', module: 'core', event: 'new-event' });
      await logger.flush();
      expect(readRows(temp.dir, 'diagnostic_events').map((row) => row.event)).toEqual(['new-event']);
      await first;
    } finally {
      await logger.close();
      temp.cleanup();
    }
  });

  it('关闭时提交在上一轮 flush 之后入队的记录', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    try {
      const flushing = logger.flush();
      logger.record({ level: 'info', module: 'core', event: 'core.stopped' });
      await Promise.all([flushing, logger.close()]);
      expect(readRows(temp.dir, 'diagnostic_events').map((row) => row.event)).toEqual(['core.stopped']);
    } finally {
      await logger.close();
      temp.cleanup();
    }
  });

  it('关闭后数据目录里没有日志文件', async () => {
    const temp = makeTempDataDir();
    const logger = createLogger({ dataDir: temp.dir, level: 'info', appVersion: '1.0.0' });
    logger.record({ level: 'info', module: 'core', event: 'core.started' });
    await logger.close();
    const files = readdirSync(temp.dir);
    temp.cleanup();
    expect(files.every((file) => file.startsWith('diagnostics.db'))).toBe(true);
  });
});
