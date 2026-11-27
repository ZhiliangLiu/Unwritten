import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import PQueue from 'p-queue';
import type { PlanJobView, Preview, PreviewJobView, PreviewJobView as PreviewJobViewType } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import { diagnosticFault, storageError } from '../log/fault.ts';
import type { AuthoringService, CoreDeps, LlmService } from '../services.ts';
import { previewJobView } from '../library/service.ts';
import { createPlanJobs } from './plan-job.ts';
import { confirmPlan, removePlanItem, updatePlanItem } from './plan-edit.ts';
import { PREVIEW_TOOL_NAME, parsePreviewArgs, previewToolParameters } from './preview-tool.ts';
import type { PreviewField } from './preview-tool.ts';
import { PREVIEW_SYSTEM_PROMPT, buildPreviewPrompt } from './preview-prompt.ts';
import { entities, jobs, workVersions, works } from '../store/schema.ts';
import type { PreviewJobResult, VersionMeta } from '../store/meta.ts';
import { PUBLIC_SETTING_PLAN_ITEM_ID, previewJobParts, readAnchors } from '../store/meta.ts';
import { isPlanConfirmed, readPlan, readSettings } from '../store/plan.ts';
import { createCodeBook } from '../story/codebook.ts';
import { copyAuthorSetting } from '../story/copy.ts';
import type { OpeningProposal, OpeningProposalContext } from '../story/opening-proposal.ts';
import { loadProjection } from '../story/projection.ts';
import { ValidatedChangesSchema } from '../story/types.ts';
import type { ValidatedChanges } from '../story/types.ts';
import type { LlmTool } from '../llm/types.ts';
import { LlmRunError } from '../llm/types.ts';

const PREVIEW_CONCURRENCY = 1;
const MAX_CORRECTIONS = 2;

function viewOf(row: typeof jobs.$inferSelect): PreviewJobViewType {
  return previewJobView(row);
}

export function createAuthoringService(deps: CoreDeps & { llm: LlmService }): AuthoringService {
  const queue = new PQueue({ concurrency: PREVIEW_CONCURRENCY });
  const planJobs = createPlanJobs(deps);

  const saveFailure = (jobId: string, workId: string, code: NonNullable<PreviewJobView['error']>) => {
    try {
      const updated = deps.db
        .update(jobs)
        .set({ status: 'failed', error: code, updatedAt: Date.now() })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
        .run();
      if (updated.changes) deps.bus.publish({ type: 'job.updated', workId, jobId, status: 'failed' });
    } catch (error) {
      const fault = diagnosticFault(error);
      deps.logger.record({
        level: 'error',
        module: 'authoring',
        event: 'preview.job.failed',
        jobId,
        workId,
        data: { code: storageError(fault) ?? 'save', stage: 'failure_state', ...fault },
      });
    }
  };

  const runPreviewJob = async (jobId: string, startedAt: number): Promise<void> => {
    const job = deps.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job || job.status !== 'running') return;
    deps.logger.sample({
      metric: 'preview.queue',
      durationMs: performance.now() - startedAt,
      outcome: 'ok',
      jobId,
      workId: job.workId,
    });

    const work = deps.db.select().from(works).where(eq(works.id, job.workId)).get();
    if (!work) return;
    const draft = deps.db.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get();
    if (!draft) return;
    const meta = draft.meta as VersionMeta;
    const settings = readSettings(meta);
    const projection = loadProjection(deps.db, { versionId: draft.id, chain: [] });
    const codebook = createCodeBook(projection);
    const nameField = settings.protagonist.fields.find((field) => field.isName) ?? null;
    const protagonistName = projection.entities.get(projection.protagonistId)?.name ?? '';
    const forbiddenNames = nameField ? [...new Set([protagonistName, nameField.defaultValue].filter(Boolean))] : [];
    const stateDefaults = new Map(
      (readPlan(meta)?.items ?? []).flatMap((item) =>
        item.kind === 'state' ? [[item.id, { value: item.initial, visible: !item.hidden }] as const] : [],
      ),
    );
    const ctx: OpeningProposalContext = {
      projection,
      codebook,
      hintMode: settings.actions.hints,
      fixedProse: settings.opening.mode === 'author_text' ? settings.opening.text : null,
      fieldNames: settings.protagonist.fields.map((field) => field.name),
      forbiddenNames,
      placeholderPolicy: settings.opening.mode === 'author_text' ? 'review' : 'reject',
      slots:
        settings.cast.mode === 'per_run'
          ? (meta.castSlots ?? []).map((slot, index) => ({ index: String(index + 1), slotId: slot.id, name: null }))
          : [],
      stateDefaults,
    };

    let preview: Preview | null = null;
    let changes: ValidatedChanges | null = null;
    let initialState: OpeningProposal['initialState'] | null = null;
    let slotOf: Map<number, string> | null = null;
    let corrections = 0;
    const rejected: { last: { errorCount: number; fields: PreviewField[] } | null } = { last: null };
    const tool: LlmTool = {
      name: PREVIEW_TOOL_NAME,
      description: '提交开场预览的标题、简介、公开设定、正文、推荐行动、场景和初始状态。',
      parameters: previewToolParameters(settings.opening.mode, settings.cast.mode),
      async execute(args) {
        const started = performance.now();
        const parsed = parsePreviewArgs(args, ctx);
        const failure = parsed.ok ? null : { errorCount: parsed.errors.length, fields: parsed.fields };
        if (failure) rejected.last = failure;
        deps.logger.sample({
          metric: 'preview.validate',
          durationMs: performance.now() - started,
          outcome: parsed.ok ? 'ok' : 'error',
          jobId,
          workId: job.workId,
          data: failure ?? undefined,
        });
        if (parsed.ok) {
          preview = parsed.value.preview;
          changes = parsed.value.changes;
          initialState = parsed.value.initialState;
          slotOf = parsed.value.slotOf;
          return { text: '已收到。', terminate: true };
        }
        corrections += 1;
        const message = parsed.errors.join('\n');
        if (corrections > MAX_CORRECTIONS) return { text: message, terminate: true };
        throw new Error(message);
      },
    };

    let modelFault: ReturnType<typeof diagnosticFault> | undefined;
    let errorCode: PreviewJobView['error'] = null;
    try {
      await deps.llm.run({
        purpose: 'narrator',
        system: PREVIEW_SYSTEM_PROMPT,
        prompt: buildPreviewPrompt({ meta, settings, projection, codebook }),
        tools: [tool],
        requiredToolName: PREVIEW_TOOL_NAME,
        sessionId: job.workId,
        ref: { kind: 'job', id: jobId, attempt: 1, workId: job.workId },
      });
    } catch (error) {
      if (error instanceof LlmRunError) {
        errorCode = error.code;
      } else {
        modelFault = diagnosticFault(error);
        errorCode = storageError(modelFault) ?? 'internal';
      }
    }

    if (!errorCode && !preview) errorCode = 'invalid_output';

    const now = Date.now();
    const lastFailure = rejected.last;
    const failureData =
      errorCode === 'invalid_output' && lastFailure !== null
        ? { code: errorCode, errorCount: lastFailure.errorCount, fields: lastFailure.fields }
        : { code: errorCode };
    if (errorCode) {
      deps.logger.record({
        level: 'warn',
        module: 'authoring',
        event: 'preview.job.failed',
        jobId,
        workId: job.workId,
        data: {
          ...failureData,
          stage: errorCode === 'invalid_output' && corrections > 0 ? 'validation' : 'model',
          corrections,
          ...modelFault,
        },
      });
      saveFailure(jobId, job.workId, errorCode);
      deps.logger.sample({
        metric: 'preview.total',
        durationMs: performance.now() - startedAt,
        outcome: errorCode === 'interrupted' ? 'interrupted' : 'error',
        jobId,
        workId: job.workId,
      });
      return;
    }

    const commitStarted = performance.now();
    const completedPreview = preview as unknown as Preview;
    let committed: boolean;
    try {
      const updated = deps.db
        .update(jobs)
        .set({
          status: 'done',
          result: {
            preview: completedPreview,
            changes: changes ?? undefined,
            initialState: initialState ?? undefined,
            slots: slotOf ? Object.fromEntries(slotOf) : undefined,
            adoption: null,
          } as PreviewJobResult,
          updatedAt: now,
        })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
        .run();
      committed = updated.changes !== 0;
    } catch (error) {
      const fault = diagnosticFault(error);
      errorCode = storageError(fault) ?? 'save';
      deps.logger.sample({
        metric: 'preview.commit',
        durationMs: performance.now() - commitStarted,
        outcome: 'error',
        jobId,
        workId: job.workId,
      });
      deps.logger.record({
        level: 'error',
        module: 'authoring',
        event: 'preview.job.failed',
        jobId,
        workId: job.workId,
        data: { code: errorCode, stage: 'commit', ...fault },
      });
      saveFailure(jobId, job.workId, errorCode);
      deps.logger.sample({
        metric: 'preview.total',
        durationMs: performance.now() - startedAt,
        outcome: 'error',
        jobId,
        workId: job.workId,
      });
      return;
    }

    const outcome = committed ? 'ok' : 'interrupted';
    deps.logger.sample({
      metric: 'preview.commit',
      durationMs: performance.now() - commitStarted,
      outcome,
      jobId,
      workId: job.workId,
    });
    if (committed) deps.bus.publish({ type: 'job.updated', workId: job.workId, jobId, status: 'done' });
    deps.logger.record({
      level: 'info',
      module: 'authoring',
      event: committed ? 'preview.job.done' : 'preview.job.interrupted',
      jobId,
      workId: job.workId,
    });
    deps.logger.sample({
      metric: 'preview.total',
      durationMs: performance.now() - startedAt,
      outcome,
      jobId,
      workId: job.workId,
    });
  };

  const failBackgroundJob = (jobId: string, workId: string, startedAt: number, error: unknown) => {
    const fault = diagnosticFault(error);
    const code = storageError(fault) ?? 'internal';
    deps.logger.record({
      level: 'error',
      module: 'authoring',
      event: 'preview.job.failed',
      jobId,
      workId,
      data: { code, stage: 'background', ...fault },
    });
    deps.logger.sample({
      metric: 'preview.total',
      durationMs: performance.now() - startedAt,
      outcome: 'error',
      jobId,
      workId,
    });
    saveFailure(jobId, workId, code);
  };

  const startPreviewJob = (jobId: string, workId: string) => {
    const startedAt = performance.now();
    void queue.add(() =>
      runPreviewJob(jobId, startedAt).catch((error: unknown) => failBackgroundJob(jobId, workId, startedAt, error)),
    );
  };

  return {
    generatePreview(input): PreviewJobView {
      const result = deps.db.transaction(
        (tx) => {
          const existing = tx.select().from(jobs).where(eq(jobs.id, input.jobId)).get();
          if (existing) {
            if (existing.workId !== input.workId || previewJobParts(existing).input.contentRev !== input.contentRev) {
              throw appError('idempotency_conflict', 'job id is already used');
            }
            return { view: viewOf(existing), created: false, workId: existing.workId };
          }
          const work = tx.select().from(works).where(eq(works.id, input.workId)).get();
          if (!work) throw appError('not_found', 'work not found');
          if (work.publishedId) throw appError('already_published', 'work is already published');
          const draft = tx.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get();
          if (!draft) throw appError('not_found', 'draft not found');
          if (draft.contentRev !== input.contentRev) throw appError('stale_revision', 'draft revision is stale');
          const meta = draft.meta as VersionMeta;
          const background = meta.background;
          if (!background.trim()) throw appError('background_required', 'background is empty');
          if (!isPlanConfirmed(meta, input.contentRev)) {
            throw appError('plan_not_confirmed', 'plan is not confirmed');
          }
          const settings = readSettings(meta);
          if (settings.opening.mode === 'author_text' && !settings.opening.text.trim()) {
            throw appError('invalid_input', 'author text is empty');
          }
          const running = tx
            .select()
            .from(jobs)
            .where(and(eq(jobs.workId, input.workId), eq(jobs.kind, 'preview'), eq(jobs.status, 'running')))
            .get();
          if (running) throw appError('job_running', 'a preview job is already running');
          if (!deps.llm.resolve('narrator')) throw appError('llm_not_configured', 'no narrator model');
          const now = Date.now();
          tx.insert(jobs)
            .values({
              id: input.jobId,
              workId: input.workId,
              kind: 'preview',
              status: 'running',
              input: { contentRev: input.contentRev, background, anchors: readAnchors(draft.meta as VersionMeta) },
              createdAt: now,
              updatedAt: now,
            })
            .run();
          const row = tx.select().from(jobs).where(eq(jobs.id, input.jobId)).get();
          return { view: viewOf(row!), created: true, workId: input.workId };
        },
        { behavior: 'immediate' },
      );

      if (result.created) {
        deps.bus.publish({ type: 'job.updated', workId: result.workId, jobId: input.jobId, status: 'running' });
        deps.logger.record({
          level: 'info',
          module: 'authoring',
          event: 'preview.job.started',
          jobId: input.jobId,
          workId: result.workId,
        });
        startPreviewJob(input.jobId, result.workId);
      }
      return result.view;
    },
    adoptPreview(input) {
      const adopted = deps.db.transaction(
        (tx) => {
          const job = tx.select().from(jobs).where(eq(jobs.id, input.jobId)).get();
          if (!job || job.workId !== input.workId) throw appError('not_found', 'preview job not found');
          const parts = previewJobParts(job);
          if (parts.result?.adoption) return null;
          const work = tx.select().from(works).where(eq(works.id, input.workId)).get();
          if (!work) throw appError('not_found', 'work not found');
          if (work.publishedId) throw appError('already_published', 'work is already published');
          if (job.status !== 'done' || !parts.result) throw appError('preview_not_ready', 'preview is not ready');
          const draft = tx.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get();
          if (!draft) throw appError('not_found', 'draft not found');
          if (parts.input.contentRev !== draft.contentRev) throw appError('stale_preview', 'preview is stale');
          const preview = parts.result.preview;
          if (preview.needsReview.length > 0) throw appError('opening_needs_review', 'opening has unresolved text');
          if (!parts.result.changes) throw appError('stale_preview', 'preview predates story facts');
          const changes = ValidatedChangesSchema.parse(parts.result.changes);
          const meta = draft.meta as VersionMeta;
          const settings = readSettings(meta);
          const slotLines = new Set(Object.keys(parts.result.slots ?? {}).map(Number));
          const createdIds = new Map<number, string>();
          for (const entity of changes.entities) {
            if (!slotLines.has(entity.line)) createdIds.set(entity.line, randomUUID());
          }
          if (createdIds.size) {
            tx.insert(entities)
              .values(
                changes.entities.flatMap((entity) => {
                  const id = createdIds.get(entity.line);
                  if (!id) return [];
                  return [
                    {
                      versionId: draft.id,
                      id,
                      kind: entity.kind,
                      name: entity.name,
                      profile: { text: entity.profile },
                      isProtagonist: entity.protagonist ? 1 : 0,
                      originTurnId: null,
                    },
                  ];
                }),
              )
              .run();
          }
          const scenePresent = (changes.scene?.present ?? []).flatMap((ref) => {
            if ('created' in ref) {
              const entity = changes.entities.find((candidate) => candidate.line === ref.created);
              const id = createdIds.get(ref.created);
              return id ? [{ name: entity?.name ?? '', id }] : [];
            }
            return [{ name: '', id: ref.existing }];
          });
          const openingScene = {
            place: preview.scene.place,
            time: preview.scene.time,
            present: scenePresent.map((item) => item.name),
            presentIds: scenePresent.map((item) => item.id),
          };
          const now = Date.now();
          const nextRev = draft.contentRev + 1;
          const publishedId = randomUUID();
          const currentPlan = readPlan(meta);
          const publicSetting = {
            kind: 'summary' as const,
            key: 'public_setting' as const,
            id: PUBLIC_SETTING_PLAN_ITEM_ID,
            text: preview.publicSetting,
            source: 'ai' as const,
          };
          const hasPublicSetting = (currentPlan?.items ?? []).some(
            (item) => item.kind === 'summary' && item.key === 'public_setting',
          );
          const items = (currentPlan?.items ?? []).map((item) =>
            item.kind === 'summary' && item.key === 'public_setting' ? publicSetting : item,
          );
          if (!hasPublicSetting) items.push(publicSetting);
          const createdIdRecord = Object.fromEntries([...createdIds].map(([line, id]) => [String(line), id]));
          const nextMeta: VersionMeta = {
            ...meta,
            plan: { items, conflicts: currentPlan?.conflicts ?? [], confirmedRev: nextRev },
            narration: { language: preview.language },
            opening: {
              prose: preview.prose,
              options: preview.options,
              scene: openingScene,
              changes,
              initialState: parts.result.initialState ?? [],
              createdIds: createdIdRecord,
              template: settings.cast.mode === 'per_run',
            },
          };
          const { wizardStep: _wizardStep, ...publishedMeta } = nextMeta;
          tx.update(workVersions)
            .set({ meta: nextMeta, contentRev: nextRev, updatedAt: now })
            .where(eq(workVersions.id, draft.id))
            .run();
          tx.insert(workVersions)
            .values({
              id: publishedId,
              workId: work.id,
              kind: 'published',
              copiedFrom: draft.id,
              contentRev: nextRev,
              sourceRev: nextRev,
              meta: publishedMeta,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          copyAuthorSetting(tx, { fromVersionId: draft.id, toVersionId: publishedId });
          tx.update(works)
            .set({ title: preview.title, blurb: preview.blurb, publishedId, updatedAt: now })
            .where(eq(works.id, work.id))
            .run();
          tx.update(jobs)
            .set({
              result: { ...parts.result, adoption: { versionId: publishedId, routeId: null } },
              updatedAt: now,
            })
            .where(eq(jobs.id, job.id))
            .run();
          return { versionId: publishedId };
        },
        { behavior: 'immediate' },
      );
      if (!adopted) return { routeId: null };
      deps.bus.publish({ type: 'works.changed', workId: input.workId });
      deps.logger.record({
        level: 'info',
        module: 'authoring',
        event: 'work.adopted',
        workId: input.workId,
        jobId: input.jobId,
        data: { versionId: adopted.versionId },
      });
      return { routeId: null };
    },
    generatePlan(input): PlanJobView {
      return planJobs.generatePlan(input);
    },
    adoptStalePlan(input) {
      return planJobs.adoptStalePlan(input);
    },
    updatePlanItem(input) {
      return updatePlanItem(deps, input);
    },
    removePlanItem(input) {
      return removePlanItem(deps, input);
    },
    confirmPlan(input) {
      return confirmPlan(deps, input);
    },
    recoverInterrupted(): number {
      const now = Date.now();
      const recovered = deps.db.all<{ id: string; work_id: string; kind: string }>(
        sql`update jobs set status = 'failed', error = 'interrupted', updated_at = ${now}
            where status = 'running' and kind in ('preview', 'plan')
            returning id, work_id, kind`,
      );
      for (const row of recovered) {
        deps.bus.publish({ type: 'job.updated', workId: row.work_id, jobId: row.id, status: 'failed' });
        deps.logger.record({
          level: 'warn',
          module: 'authoring',
          event: row.kind === 'plan' ? 'plan.job.failed' : 'preview.job.failed',
          jobId: row.id,
          workId: row.work_id,
          data: { code: 'interrupted' },
        });
      }
      return recovered.length;
    },
    whenIdle() {
      return Promise.all([queue.onIdle(), planJobs.whenIdle()]).then(() => undefined);
    },
  };
}
