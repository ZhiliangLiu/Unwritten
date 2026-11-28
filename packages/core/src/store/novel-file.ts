import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { UuidSchema } from '@unwritten/contracts';
import { eq } from 'drizzle-orm';
import { appError } from '../errors.ts';
import type { Database } from './db.ts';
import { jobs } from './schema.ts';

const novelDirectory = (dataDir: string) => join(dataDir, 'novels');

function novelFileName(workId: string): string {
  return `${Buffer.from(UuidSchema.parse(workId), 'ascii').toString('hex')}.txt`;
}

export function novelFilePath(dataDir: string, workId: string): string {
  return join(novelDirectory(dataDir), novelFileName(workId));
}

export function writeNovelPart(
  dataDir: string,
  input: { workId: string; offset: number; totalBytes: number; bytes: Buffer; committed: boolean },
): void {
  const { workId, offset, totalBytes, bytes, committed } = input;
  const path = novelFilePath(dataDir, workId);
  const size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
  if (offset > size || size > totalBytes || (committed && size !== totalBytes)) {
    throw appError('idempotency_conflict', 'novel upload offset or size changed');
  }
  const existingLength = Math.min(size - offset, bytes.length);
  if (existingLength > 0) {
    const fd = openSync(path, 'r');
    try {
      const previous = Buffer.alloc(existingLength);
      if (
        readSync(fd, previous, 0, existingLength, offset) !== existingLength ||
        !previous.equals(bytes.subarray(0, existingLength))
      ) {
        throw appError('idempotency_conflict', 'novel upload bytes changed');
      }
    } finally {
      closeSync(fd);
    }
  }
  if (existingLength < bytes.length) {
    mkdirSync(novelDirectory(dataDir), { recursive: true });
    appendFileSync(path, bytes.subarray(existingLength), { mode: 0o600 });
  }
}

export function removeNovelFile(dataDir: string, workId: string): void {
  rmSync(novelFilePath(dataDir, workId), { force: true });
}

export function pruneNovelFiles(db: Database, dataDir: string): void {
  const directory = novelDirectory(dataDir);
  if (!existsSync(directory)) return;
  const owned = new Set(
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.kind, 'novel_source'))
      .all()
      .map((row) => novelFileName(row.id)),
  );
  for (const entry of readdirSync(directory)) {
    if (/^[a-f0-9]{72}\.txt$/u.test(entry) && !owned.has(entry)) rmSync(join(directory, entry), { force: true });
  }
}
