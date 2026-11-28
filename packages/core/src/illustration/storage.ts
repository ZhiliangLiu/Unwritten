import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import PQueue from 'p-queue';
import { diagnosticFault } from '../log/fault.ts';
import type { Logger } from '../log/logger.ts';
import { IMAGE_EXTENSION } from '../image/limits.ts';
import { validateImageBytes } from '../image/validate.ts';
import type { ImageFileRef } from '../store/illustration-types.ts';

export interface StagedImage {
  ref: ImageFileRef;
  tempPath: string;
}

export interface ImageStore {
  readonly root: string;
  stage(bytes: Uint8Array, options?: { rejectMetadata?: boolean; maxBytes?: number }): Promise<StagedImage>;
  commit<T>(staged: StagedImage[], transaction: () => T, assertCurrent?: () => void): Promise<T>;
  read(ref: ImageFileRef): Promise<Uint8Array | null>;
  pathOf(ref: ImageFileRef): string;
  exclusive<T>(task: () => Promise<T> | T): Promise<T>;
  clearTemp(): void;
}

export type ImageStoreStage = 'validate' | 'temp_write' | 'rename' | 'commit';

export class ImageStoreError extends Error {
  readonly stage: ImageStoreStage;
  readonly systemCode: string | null;

  constructor(stage: ImageStoreStage, message: string, systemCode: string | null = null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ImageStoreError';
    this.stage = stage;
    this.systemCode = systemCode;
  }
}

function systemCodeOf(error: unknown): string | null {
  return diagnosticFault(error).systemCode ?? null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createImageStore(dataDir: string, logger?: Logger): ImageStore {
  const root = join(dataDir, 'images');
  const blobsDir = join(root, 'blobs');
  const tmpDir = join(root, 'tmp');
  const queue = new PQueue({ concurrency: 1 });

  mkdirSync(blobsDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  const pathOf = (ref: ImageFileRef): string => join(blobsDir, `${ref.hash}.${IMAGE_EXTENSION[ref.mime]}`);

  const recordFailure = (stage: ImageStoreStage, code: string | null) => {
    if (code === null) return;
    logger?.record({
      level: 'error',
      module: 'illustration',
      event: 'image.store.failed',
      data: { stage, code },
    });
  };

  const failure = (stage: ImageStoreStage, error: unknown): ImageStoreError => {
    const systemCode = systemCodeOf(error);
    recordFailure(stage, systemCode);
    return new ImageStoreError(stage, messageOf(error), systemCode, error);
  };

  const discardTemp = (staged: StagedImage[]) => {
    for (const item of staged) rmSync(item.tempPath, { force: true });
  };

  return {
    root,
    async stage(bytes, options) {
      const validation = validateImageBytes(bytes, {
        rejectMetadata: options?.rejectMetadata,
        maxBytes: options?.maxBytes,
      });
      if (!validation.ok) throw new ImageStoreError('validate', validation.reason);

      const hash = createHash('sha256').update(bytes).digest('hex');
      const ref: ImageFileRef = {
        hash,
        mime: validation.image.mime,
        width: validation.image.width,
        height: validation.image.height,
        bytes: bytes.length,
      };
      const tempPath = join(tmpDir, `${randomUUID()}.part`);
      try {
        writeFileSync(tempPath, bytes, { mode: 0o600 });
      } catch (error) {
        throw failure('temp_write', error);
      }
      return { ref, tempPath };
    },
    async commit(staged, transaction, assertCurrent) {
      return queue.add(async () => {
        try {
          assertCurrent?.();
        } catch (error) {
          discardTemp(staged);
          throw error;
        }

        for (const item of staged) {
          const target = pathOf(item.ref);
          if (existsSync(target)) {
            rmSync(item.tempPath, { force: true });
            continue;
          }
          try {
            renameSync(item.tempPath, target);
          } catch (error) {
            throw failure('rename', error);
          }
        }

        try {
          return transaction();
        } catch (error) {
          recordFailure('commit', error instanceof ImageStoreError ? error.systemCode : systemCodeOf(error));
          throw error;
        }
      });
    },
    async read(ref) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(pathOf(ref));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      if (bytes.length !== ref.bytes) {
        logger?.record({
          level: 'warn',
          module: 'illustration',
          event: 'image.store.mismatch',
          data: { expectedBytes: ref.bytes, actualBytes: bytes.length },
        });
        return null;
      }
      return bytes;
    },
    pathOf,
    exclusive(task) {
      return queue.add(task);
    },
    clearTemp() {
      rmSync(tmpDir, { recursive: true, force: true });
      mkdirSync(tmpDir, { recursive: true });
    },
  };
}
