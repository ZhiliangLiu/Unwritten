import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  EMPTY_WORK_ANCHORS,
  SETTING_SECTION_IDS,
  WorkSettingsSchema,
  type PlanJobView,
  type PreviewJobView,
  type SaveDraftInput,
  type SaveDraftOutput,
  type SetWizardStepInput,
  type SettingSectionId,
  type WorkDetail,
  type WorkIdInput,
  type WorkSummary,
} from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { CoreDeps, LibraryService } from '../services.ts';
import type { Database } from '../store/db.ts';
import { jobs, playthroughs, routes, workVersions, works } from '../store/schema.ts';
import { planJobParts, previewJobParts, readAnchors, type StoredSettings, type VersionMeta } from '../store/meta.ts';
import { planView, readSettings, settingsView } from '../store/plan.ts';

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
    const played = db
      .select()
      .from(playthroughs)
      .where(and(eq(playthroughs.versionId, row.publishedId), eq(playthroughs.kind, 'play')))
      .all();
    if (played.length > 0) {
      const route = db
        .select()
        .from(routes)
        .where(
          inArray(
            routes.playthroughId,
            played.map((playthrough) => playthrough.id),
          ),
        )
        .orderBy(desc(routes.updatedAt))
        .get();
      const playthrough = route ? played.find((candidate) => candidate.id === route.playthroughId) : undefined;
      if (route && playthrough) {
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
  const parts = previewJobParts(row);
  return {
    id: row.id,
    status: row.status,
    basedOnContentRev: parts.input.contentRev,
    error: (row.error as PreviewJobView['error']) ?? null,
    preview: parts.result?.preview ?? null,
    updatedAt: row.updatedAt,
  };
}

export function planJobView(row: typeof jobs.$inferSelect): PlanJobView {
  const parts = planJobParts(row);
  return {
    id: row.id,
    status: row.status,
    basedOnContentRev: parts.input.contentRev,
    error: (row.error as PlanJobView['error']) ?? null,
    stale: parts.result?.stale ?? false,
    updatedAt: row.updatedAt,
  };
}

export function createLibraryService(deps: CoreDeps & { onWorkDeleted?: () => void }): LibraryService {
  const getWork = (input: WorkIdInput): WorkDetail => {
    const row = deps.db.select().from(works).where(eq(works.id, input.workId)).get();
    if (!row) throw appError('not_found', 'work not found');
    const draft = deps.db.select().from(workVersions).where(eq(workVersions.id, row.draftId)).get();
    if (!draft) throw appError('not_found', 'draft not found');
    const summary = summarize(deps.db, row);
    const previewJob = deps.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.workId, row.id), eq(jobs.kind, 'preview')))
      .orderBy(desc(jobs.createdAt))
      .get();
    const planJob = deps.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.workId, row.id), eq(jobs.kind, 'plan')))
      .orderBy(desc(jobs.createdAt))
      .get();
    const meta = draft.meta as VersionMeta;
    return {
      id: row.id,
      title: row.title,
      blurb: row.blurb,
      status: summary.status,
      draft: {
        contentRev: draft.contentRev,
        background: meta.background,
        anchors: readAnchors(meta),
        settings: settingsView(readSettings(meta)),
        wizardStep: meta.wizardStep ?? 'background',
        plan: planView(meta, draft.contentRev),
      },
      latestPreviewJob: previewJob ? previewJobView(previewJob) : null,
      latestPlanJob: planJob ? planJobView(planJob) : null,
      illustrationStyle: row.illustrationStyle ?? null,
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
    saveDraft(input: SaveDraftInput): SaveDraftOutput {
      const result = deps.db.transaction(
        (tx) => {
          const work = tx.select().from(works).where(eq(works.id, input.workId)).get();
          if (!work) throw appError('not_found', 'work not found');
          if (work.publishedId) throw appError('already_published', 'work is already published');
          const draft = tx.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get();
          if (!draft) throw appError('not_found', 'draft not found');
          const meta = draft.meta as VersionMeta;
          const anchors = input.anchors ?? EMPTY_WORK_ANCHORS;
          const savedAnchors = readAnchors(meta);
          const storedSettings = readSettings(meta);
          const currentSettings = settingsView(storedSettings);
          const settings = WorkSettingsSchema.parse(input.settings);
          const sections: SettingSectionId[] = SETTING_SECTION_IDS.filter(
            (section) => JSON.stringify(currentSettings[section]) !== JSON.stringify(settings[section]),
          );
          const unchanged =
            meta.background === input.background &&
            savedAnchors.narrationDirective === anchors.narrationDirective &&
            savedAnchors.contentPolicy === anchors.contentPolicy &&
            savedAnchors.improvisationScope === anchors.improvisationScope &&
            sections.length === 0;
          if (unchanged) return { contentRev: draft.contentRev, changed: false, sections };
          if (draft.contentRev !== input.baseContentRev) throw appError('stale_revision', 'draft revision is stale');
          const now = Date.now();
          const contentRev = draft.contentRev + 1;
          const nextSettings: StoredSettings = {
            world: sections.includes('world')
              ? { ...settings.world, rev: storedSettings.world.rev + 1 }
              : storedSettings.world,
            protagonist: sections.includes('protagonist')
              ? { ...settings.protagonist, rev: storedSettings.protagonist.rev + 1 }
              : storedSettings.protagonist,
            cast: sections.includes('cast')
              ? { ...settings.cast, rev: storedSettings.cast.rev + 1 }
              : storedSettings.cast,
            secrets: sections.includes('secrets')
              ? { ...settings.secrets, rev: storedSettings.secrets.rev + 1 }
              : storedSettings.secrets,
            opening: sections.includes('opening')
              ? { ...settings.opening, rev: storedSettings.opening.rev + 1 }
              : storedSettings.opening,
            actions: sections.includes('actions')
              ? { ...settings.actions, rev: storedSettings.actions.rev + 1 }
              : storedSettings.actions,
            scenes: sections.includes('scenes')
              ? { ...settings.scenes, rev: storedSettings.scenes.rev + 1 }
              : storedSettings.scenes,
            status: sections.includes('status')
              ? { ...settings.status, rev: storedSettings.status.rev + 1 }
              : storedSettings.status,
          };
          const nextMeta: VersionMeta = { ...meta, background: input.background, anchors, settings: nextSettings };
          tx.update(workVersions)
            .set({ meta: nextMeta, contentRev, updatedAt: now })
            .where(eq(workVersions.id, draft.id))
            .run();
          tx.update(works).set({ updatedAt: now }).where(eq(works.id, work.id)).run();
          return { contentRev, changed: true, sections };
        },
        { behavior: 'immediate' },
      );
      if (result.changed) {
        deps.bus.publish({ type: 'works.changed', workId: input.workId });
        deps.logger.record({
          level: 'info',
          module: 'library',
          event: 'work.draft.saved',
          workId: input.workId,
          data: { contentRev: result.contentRev, sections: result.sections },
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
      deps.onWorkDeleted?.();
      return {};
    },
    setWizardStep(input: SetWizardStepInput): Record<string, never> {
      const step = deps.db.transaction(
        (tx) => {
          const work = tx.select().from(works).where(eq(works.id, input.workId)).get();
          if (!work) throw appError('not_found', 'work not found');
          if (work.publishedId) return null;
          const draft = tx.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get();
          if (!draft) throw appError('not_found', 'draft not found');
          const meta = draft.meta as VersionMeta;
          if ((meta.wizardStep ?? 'background') === input.step) return null;
          tx.update(workVersions)
            .set({ meta: { ...meta, wizardStep: input.step } })
            .where(eq(workVersions.id, draft.id))
            .run();
          return input.step;
        },
        { behavior: 'immediate' },
      );
      if (step) {
        deps.logger.record({
          level: 'debug',
          module: 'library',
          event: 'work.wizard_step',
          workId: input.workId,
          data: { step },
        });
      }
      return {};
    },
  };
}
