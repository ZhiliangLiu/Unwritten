import { and, desc, eq } from 'drizzle-orm';
import type {
  PreviewJobView,
  SaveBackgroundInput,
  SaveBackgroundOutput,
  WorkDetail,
  WorkIdInput,
  WorkSummary,
} from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { CoreDeps, LibraryService } from '../services.ts';
import type { Database } from '../store/db.ts';
import { jobs, playthroughs, routes, workVersions, works } from '../store/schema.ts';
import type { VersionMeta } from '../store/meta.ts';

export function workLabel(title: string | null, background: string): string {
  if (title) return title;
  const firstLine = background
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return '';
  return Array.from(firstLine).slice(0, 40).join('');
}

function summarize(db: Database, row: typeof works.$inferSelect): WorkSummary {
  const draft = db.select().from(workVersions).where(eq(workVersions.id, row.draftId)).get();
  const background = (draft?.meta as VersionMeta | undefined)?.background ?? '';
  let routeId: string | null = null;
  let hasProgress = false;
  if (row.publishedId) {
    const playthrough = db
      .select()
      .from(playthroughs)
      .where(and(eq(playthroughs.versionId, row.publishedId), eq(playthroughs.kind, 'play')))
      .orderBy(playthroughs.createdAt)
      .get();
    if (playthrough) {
      const route = db
        .select()
        .from(routes)
        .where(eq(routes.playthroughId, playthrough.id))
        .orderBy(routes.createdAt)
        .get();
      if (route) {
        routeId = route.id;
        hasProgress = route.headTurnId !== playthrough.rootTurnId;
      }
    }
  }
  return {
    id: row.id,
    title: row.title,
    blurb: row.blurb,
    label: workLabel(row.title, background),
    status: row.publishedId ? 'playable' : 'draft',
    hasProgress,
    routeId,
    updatedAt: row.updatedAt,
  };
}

export function previewJobView(row: typeof jobs.$inferSelect): PreviewJobView {
  return {
    id: row.id,
    status: row.status,
    basedOnContentRev: row.input.contentRev,
    error: (row.error as PreviewJobView['error']) ?? null,
    preview: row.result?.preview ?? null,
    updatedAt: row.updatedAt,
  };
}

export function createLibraryService(deps: CoreDeps): LibraryService {
  const getWork = (input: WorkIdInput): WorkDetail => {
    const row = deps.db.select().from(works).where(eq(works.id, input.workId)).get();
    if (!row) throw appError('not_found', 'work not found');
    const draft = deps.db.select().from(workVersions).where(eq(workVersions.id, row.draftId)).get();
    if (!draft) throw appError('not_found', 'draft not found');
    const summary = summarize(deps.db, row);
    const job = deps.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.workId, row.id), eq(jobs.kind, 'preview')))
      .orderBy(desc(jobs.createdAt))
      .get();
    return {
      id: row.id,
      title: row.title,
      blurb: row.blurb,
      status: summary.status,
      routeId: summary.routeId,
      draft: { contentRev: draft.contentRev, background: (draft.meta as VersionMeta).background },
      latestPreviewJob: job ? previewJobView(job) : null,
    };
  };

  return {
    list() {
      return deps.db
        .select()
        .from(works)
        .orderBy(desc(works.updatedAt))
        .all()
        .map((row) => summarize(deps.db, row));
    },
    create(input) {
      const created = deps.db.transaction(
        (tx) => {
          const existing = tx.select().from(works).where(eq(works.id, input.workId)).get();
          if (existing) return false;
          const now = Date.now();
          const draftId = crypto.randomUUID();
          tx.insert(works).values({ id: input.workId, draftId, createdAt: now, updatedAt: now }).run();
          tx.insert(workVersions)
            .values({
              id: draftId,
              workId: input.workId,
              kind: 'draft',
              contentRev: 0,
              meta: { background: '' },
              createdAt: now,
              updatedAt: now,
            })
            .run();
          return true;
        },
        { behavior: 'immediate' },
      );
      if (created) {
        deps.bus.publish({ type: 'works.changed', workId: input.workId });
        deps.logger.record({ level: 'info', module: 'library', event: 'work.created', workId: input.workId });
      }
      return getWork(input);
    },
    get: getWork,
    saveBackground(input: SaveBackgroundInput): SaveBackgroundOutput {
      const result = deps.db.transaction(
        (tx) => {
          const work = tx.select().from(works).where(eq(works.id, input.workId)).get();
          if (!work) throw appError('not_found', 'work not found');
          if (work.publishedId) throw appError('already_published', 'work is already published');
          const draft = tx.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get();
          if (!draft) throw appError('not_found', 'draft not found');
          const meta = draft.meta as VersionMeta;
          if (meta.background === input.background) return { contentRev: draft.contentRev, changed: false };
          if (draft.contentRev !== input.baseContentRev) throw appError('stale_revision', 'draft revision is stale');
          const now = Date.now();
          const contentRev = draft.contentRev + 1;
          tx.update(workVersions)
            .set({ meta: { ...meta, background: input.background }, contentRev, updatedAt: now })
            .where(eq(workVersions.id, draft.id))
            .run();
          tx.update(works).set({ updatedAt: now }).where(eq(works.id, work.id)).run();
          return { contentRev, changed: true };
        },
        { behavior: 'immediate' },
      );
      if (result.changed) {
        deps.bus.publish({ type: 'works.changed', workId: input.workId });
        deps.logger.record({
          level: 'info',
          module: 'library',
          event: 'work.background.saved',
          workId: input.workId,
          data: { contentRev: result.contentRev },
        });
      }
      return { contentRev: result.contentRev };
    },
    delete(input: WorkIdInput): Record<string, never> {
      const changes = deps.db.transaction((tx) => tx.delete(works).where(eq(works.id, input.workId)).run().changes, {
        behavior: 'immediate',
      });
      if (changes === 0) return {};
      deps.bus.publish({ type: 'works.changed', workId: input.workId });
      deps.logger.record({ level: 'info', module: 'library', event: 'work.deleted', workId: input.workId });
      return {};
    },
  };
}
