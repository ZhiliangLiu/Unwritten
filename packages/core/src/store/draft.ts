import { randomUUID } from 'node:crypto';
import type { Database } from './db.ts';
import type { VersionMeta } from './meta.ts';
import { works, workVersions } from './schema.ts';

export function insertDraft(
  tx: Pick<Database, 'insert'>,
  input: { workId: string; title?: string; meta: VersionMeta },
): void {
  const now = Date.now();
  const draftId = randomUUID();
  tx.insert(works).values({ id: input.workId, draftId, title: input.title, createdAt: now, updatedAt: now }).run();
  tx.insert(workVersions)
    .values({
      id: draftId,
      workId: input.workId,
      kind: 'draft',
      contentRev: 0,
      meta: input.meta,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}
