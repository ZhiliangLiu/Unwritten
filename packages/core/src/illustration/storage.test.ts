import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LogEvent, Logger, PerformanceSample } from '../log/logger.ts';
import { pngBytes } from '../test-support/image-bytes.ts';
import { makeTempDataDir } from '../test-support/temp-dir.ts';
import { ImageStoreError, createImageStore } from './storage.ts';

function captureLogger(): { logger: Logger; events: LogEvent[]; samples: PerformanceSample[] } {
  const events: LogEvent[] = [];
  const samples: PerformanceSample[] = [];
  return {
    events,
    samples,
    logger: {
      record(event) {
        events.push(event);
      },
      sample(sample) {
        samples.push(sample);
      },
      async flush() {},
      async close() {},
    },
  };
}

function setup(): {
  dir: string;
  root: string;
  events: LogEvent[];
  store: ReturnType<typeof createImageStore>;
  cleanup(): void;
} {
  const temp = makeTempDataDir();
  const { logger, events } = captureLogger();
  return {
    dir: temp.dir,
    root: join(temp.dir, 'images'),
    events,
    store: createImageStore(temp.dir, logger),
    cleanup: () => temp.cleanup(),
  };
}

describe('image store', () => {
  it('暂存后提交，临时文件改名成哈希文件', async () => {
    const fixture = setup();
    try {
      const bytes = pngBytes(4, 4);
      const staged = await fixture.store.stage(bytes);
      expect(staged.tempPath.startsWith(join(fixture.root, 'tmp'))).toBe(true);
      expect(staged.tempPath.endsWith('.part')).toBe(true);
      expect(readdirSync(join(fixture.root, 'tmp'))).toHaveLength(1);
      expect(readdirSync(join(fixture.root, 'blobs'))).toHaveLength(0);

      const result = await fixture.store.commit([staged], () => 'committed');

      expect(result).toBe('committed');
      expect(readdirSync(join(fixture.root, 'tmp'))).toHaveLength(0);
      expect(readdirSync(join(fixture.root, 'blobs'))).toEqual([`${staged.ref.hash}.png`]);
      await expect(fixture.store.read(staged.ref)).resolves.toEqual(Buffer.from(bytes));
    } finally {
      fixture.cleanup();
    }
  });

  it('相同内容只存一份', async () => {
    const fixture = setup();
    try {
      const bytes = pngBytes(4, 4);
      const first = await fixture.store.stage(bytes);
      const second = await fixture.store.stage(bytes);
      await fixture.store.commit([first], () => undefined);
      await fixture.store.commit([second], () => undefined);
      expect(readdirSync(join(fixture.root, 'blobs'))).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('事务里的业务错误不记为存储故障，系统错误才记并原样抛出', async () => {
    const fixture = setup();
    try {
      const staged = await fixture.store.stage(pngBytes(4, 4));
      const businessFailure = Object.assign(new Error('stale revision'), { code: 'stale_revision' });
      await expect(
        fixture.store.commit([staged], () => {
          throw businessFailure;
        }),
      ).rejects.toBe(businessFailure);
      expect(existsSync(fixture.store.pathOf(staged.ref))).toBe(true);
      expect(fixture.events.filter((event) => event.event === 'image.store.failed')).toHaveLength(0);

      const systemFailure = Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
      const stagedAgain = await fixture.store.stage(pngBytes(5, 5));
      await expect(
        fixture.store.commit([stagedAgain], () => {
          throw systemFailure;
        }),
      ).rejects.toBe(systemFailure);
      expect(existsSync(fixture.store.pathOf(stagedAgain.ref))).toBe(true);
      expect(fixture.events).toContainEqual(
        expect.objectContaining({ event: 'image.store.failed', data: { stage: 'commit', code: 'ENOSPC' } }),
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('拒绝带元数据的图片，不留下临时文件', async () => {
    const fixture = setup();
    try {
      const bytes = pngBytes(1, 1, { textChunk: 'x' });
      const error = await fixture.store.stage(bytes, { rejectMetadata: true }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ImageStoreError);
      expect(error).toMatchObject({ stage: 'validate', message: 'metadata' });
      expect(readdirSync(join(fixture.root, 'tmp'))).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('文件缺失或长度不符时读取返回 null，长度不符记事件', async () => {
    const fixture = setup();
    try {
      const bytes = pngBytes(4, 4);
      const staged = await fixture.store.stage(bytes);
      await fixture.store.commit([staged], () => undefined);
      await expect(fixture.store.read(staged.ref)).resolves.toEqual(Buffer.from(bytes));

      const path = fixture.store.pathOf(staged.ref);
      writeFileSync(path, Buffer.alloc(staged.ref.bytes + 1));
      await expect(fixture.store.read(staged.ref)).resolves.toBeNull();
      expect(fixture.events).toContainEqual(
        expect.objectContaining({
          event: 'image.store.mismatch',
          data: { expectedBytes: staged.ref.bytes, actualBytes: staged.ref.bytes + 1 },
        }),
      );

      rmSync(path);
      await expect(fixture.store.read(staged.ref)).resolves.toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it('提交和清理共用串行锁，守卫在拿锁后才运行', async () => {
    const fixture = setup();
    try {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = () => resolve();
      });
      const blocked = fixture.store.exclusive(() => gate);

      let guardCalls = 0;
      let transactionCalls = 0;
      let allowed = true;
      const staged = await fixture.store.stage(pngBytes(4, 4));
      const commit = fixture.store.commit(
        [staged],
        () => {
          transactionCalls += 1;
          return 'written';
        },
        () => {
          guardCalls += 1;
          if (!allowed) throw new Error('revoked');
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(guardCalls).toBe(0);
      expect(transactionCalls).toBe(0);

      allowed = false;
      release();
      await blocked;
      await expect(commit).rejects.toThrow('revoked');
      expect(guardCalls).toBe(1);
      expect(transactionCalls).toBe(0);
      expect(existsSync(fixture.store.pathOf(staged.ref))).toBe(false);
      expect(readdirSync(join(fixture.root, 'tmp'))).toHaveLength(0);

      const valid = await fixture.store.stage(pngBytes(5, 5));
      await expect(fixture.store.commit([valid], () => 'written')).resolves.toBe('written');
      expect(existsSync(fixture.store.pathOf(valid.ref))).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });
});
