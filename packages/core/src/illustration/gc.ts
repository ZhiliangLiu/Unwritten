import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, lt, notInArray, sql, type SQL } from 'drizzle-orm';
import type { Logger } from '../log/logger.ts';
import type { Database } from '../store/db.ts';
import type { ImageFileRef, PortraitTasks } from '../store/illustration-types.ts';
import { illustrations, portraitSets } from '../store/schema.ts';
import { IMAGE_GC_GRACE_MS, PORTRAIT_PREVIEW_TTL_DAYS } from './constants.ts';
import type { ImageStore } from './storage.ts';

export interface GcResult {
  sets: number;
  files: number;
  bytes: number;
}

const DAY_MS = 86_400_000;
const REMOVED_ILLUSTRATION_STATUSES = ['dismissed', 'cancelled'] as const;
const BLOB_NAME = /^([0-9a-f]{64})\.[a-z0-9]+$/u;

function queryIds(db: Database, query: SQL): Set<string> {
  const rows = db.all(query) as Array<{ id?: unknown }>;
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row.id === 'string') ids.add(row.id);
  }
  return ids;
}

function referencedSetIds(db: Database): Set<string> {
  return queryIds(
    db,
    sql`select json_extract(p.illustration, '$.protagonistPortraitSetId') as id
          from playthroughs p
          where json_extract(p.illustration, '$.protagonistPortraitSetId') is not null
        union
        select value as id from playthroughs p, json_each(p.illustration, '$.authorPortraitSetIds')
        union
        select value ->> '$.setId' as id
          from illustrations i, json_each(i.reference_files)
          where i.status not in ('dismissed', 'cancelled') and value ->> '$.setId' is not null
        union
        select value ->> '$.setId' as id
          from illustrations i, json_each(i.attempt_data, '$.referenceFiles')
          where i.status not in ('dismissed', 'cancelled') and value ->> '$.setId' is not null`,
  );
}

function existingEntityIds(db: Database): Set<string> {
  return queryIds(
    db,
    sql`select e.id as id
          from entities e
          join works w on e.version_id = w.draft_id or e.version_id = w.published_id
        union
        select value ->> '$.id' as id
          from works w, work_versions v, json_each(v.meta, '$.plan.items')
          where v.id = w.draft_id and value ->> '$.kind' = 'entity'`,
  );
}

function hasRunningTask(tasks: PortraitTasks | null): boolean {
  if (!tasks) return false;
  return [tasks.front, tasks.three_quarter, tasks.full_body].some((task) => task?.status === 'running');
}

export function referencedFiles(db: Database): Map<string, ImageFileRef> {
  const files = new Map<string, ImageFileRef>();
  const add = (ref: ImageFileRef | null | undefined) => {
    if (ref) files.set(ref.hash, ref);
  };

  const setRows = db.select({ slots: portraitSets.slots, task: portraitSets.task }).from(portraitSets).all();
  for (const row of setRows) {
    add(row.slots.front.file);
    add(row.slots.three_quarter.file);
    add(row.slots.full_body.file);
    if (!row.task) continue;
    for (const task of [row.task.front, row.task.three_quarter, row.task.full_body]) {
      if (!task) continue;
      for (const file of task.inputFiles) add(file);
    }
  }

  const illustrationRows = db
    .select({
      file: illustrations.file,
      referenceFiles: illustrations.referenceFiles,
      attemptData: illustrations.attemptData,
    })
    .from(illustrations)
    .where(notInArray(illustrations.status, [...REMOVED_ILLUSTRATION_STATUSES]))
    .all();
  for (const row of illustrationRows) {
    add(row.file);
    for (const reference of row.referenceFiles ?? []) add(reference.file);
    for (const reference of row.attemptData?.referenceFiles ?? []) add(reference.file);
  }

  return files;
}

export function storageSummary(db: Database): { files: number; bytes: number } {
  const files = referencedFiles(db);
  let bytes = 0;
  for (const file of files.values()) bytes += file.bytes;
  return { files: files.size, bytes };
}

export function collectGarbage(deps: {
  db: Database;
  store: ImageStore;
  now: number;
  logger: Logger;
}): Promise<GcResult> {
  const startedAt = performance.now();

  return deps.store.exclusive(() => {
    const referencedIds = referencedSetIds(deps.db);

    const previewCutoff = deps.now - PORTRAIT_PREVIEW_TTL_DAYS * DAY_MS;
    const expiredPreviews = deps.db
      .select({
        id: portraitSets.id,
        state: portraitSets.state,
        entityId: portraitSets.entityId,
        task: portraitSets.task,
      })
      .from(portraitSets)
      .where(and(eq(portraitSets.scope, 'pending'), lt(portraitSets.updatedAt, previewCutoff)))
      .all();
    for (const row of expiredPreviews) {
      const isPreview = row.entityId === null;
      const isSnapshot = row.entityId !== null && row.state === 'active';
      if (!isPreview && !isSnapshot) continue;
      if (referencedIds.has(row.id)) continue;
      if (hasRunningTask(row.task)) continue;
      deps.db.delete(portraitSets).where(eq(portraitSets.id, row.id)).run();
    }

    const entityIds = existingEntityIds(deps.db);
    let sets = 0;
    const remainingSets = deps.db
      .select({
        id: portraitSets.id,
        scope: portraitSets.scope,
        state: portraitSets.state,
        entityId: portraitSets.entityId,
        task: portraitSets.task,
      })
      .from(portraitSets)
      .all();
    for (const row of remainingSets) {
      const keep =
        row.state === 'draft' ||
        row.scope === 'pending' ||
        row.scope === 'playthrough' ||
        hasRunningTask(row.task) ||
        referencedIds.has(row.id) ||
        (row.state === 'active' && row.scope === 'work' && row.entityId !== null && entityIds.has(row.entityId));
      if (keep) continue;
      deps.db.delete(portraitSets).where(eq(portraitSets.id, row.id)).run();
      sets += 1;
    }

    const referenced = referencedFiles(deps.db);
    const blobsDir = join(deps.store.root, 'blobs');
    let files = 0;
    let bytes = 0;
    for (const entry of readdirSync(blobsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = BLOB_NAME.exec(entry.name);
      if (!match) continue;
      const hash = match[1] ?? '';
      if (referenced.has(hash)) continue;
      const filePath = join(blobsDir, entry.name);
      const stats = statSync(filePath);
      if (stats.mtimeMs >= deps.now - IMAGE_GC_GRACE_MS) continue;
      rmSync(filePath);
      files += 1;
      bytes += stats.size;
    }

    const result: GcResult = { sets, files, bytes };
    deps.logger.record({
      level: 'info',
      module: 'illustration',
      event: 'image.gc',
      data: { sets, files, bytes },
    });
    deps.logger.sample({
      metric: 'image.gc',
      durationMs: performance.now() - startedAt,
      outcome: 'ok',
      data: { files, bytes },
    });
    return result;
  });
}
