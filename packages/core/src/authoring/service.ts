import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import PQueue from 'p-queue';
import type { Preview, PreviewJobView, PreviewJobView as PreviewJobViewType } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import type { AuthoringService, CoreDeps, LlmService } from '../services.ts';
import { previewJobView } from '../library/service.ts';
import { PREVIEW_TOOL_NAME, PREVIEW_TOOL_PARAMETERS, parsePreviewArgs } from './preview-tool.ts';
import { PREVIEW_SYSTEM_PROMPT, buildPreviewPrompt } from './preview-prompt.ts';
import { jobs, playthroughs, routes, turns, workVersions, works } from '../store/schema.ts';
import type { PreviewJobResult, VersionMeta } from '../store/meta.ts';
import { PUBLIC_SETTING_PLAN_ITEM_ID } from '../store/meta.ts';
import type { LlmTool } from '../llm/types.ts';
import { LlmRunError } from '../llm/types.ts';

const PREVIEW_CONCURRENCY = 1;
const MAX_CORRECTIONS = 2;

function viewOf(row: typeof jobs.$inferSelect): PreviewJobViewType {
  return previewJobView(row);
}

export function createAuthoringService(deps: CoreDeps & { llm: LlmService }): AuthoringService {
  const queue = new PQueue({ concurrency: PREVIEW_CONCURRENCY });

  const runPreviewJob = async (jobId: string): Promise<void> => {
    const job = deps.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job || job.status !== 'running') return;
    const startedAt = performance.now();
    deps.logger.sample({
      metric: 'preview.queue',
      durationMs: startedAt - job.createdAt,
      outcome: 'ok',
      jobId,
      workId: job.workId,
    });

    let preview: Preview | null = null;
    let corrections = 0;
    const tool: LlmTool = {
      name: PREVIEW_TOOL_NAME,
      description: '提交开场预览的标题、简介、公开设定、正文、推荐行动和场景。',
      parameters: PREVIEW_TOOL_PARAMETERS,
      async execute(args) {
        const started = performance.now();
        const parsed = parsePreviewArgs(args);
        deps.logger.sample({
          metric: 'preview.validate',
          durationMs: performance.now() - started,
          outcome: parsed.ok ? 'ok' : 'error',
          jobId,
          workId: job.workId,
        });
        if (parsed.ok) {
          preview = parsed.value;
          return { text: '已收到。', terminate: true };
        }
        corrections += 1;
        const message = parsed.errors.join('\n');
        if (corrections > MAX_CORRECTIONS) return { text: message, terminate: true };
        throw new Error(message);
      },
    };

    let errorCode: PreviewJobView['error'] = null;
    try {
      await deps.llm.run({
        purpose: 'narrator',
        system: PREVIEW_SYSTEM_PROMPT,
        prompt: buildPreviewPrompt(job.input.background),
        tools: [tool],
        requiredToolName: PREVIEW_TOOL_NAME,
        sessionId: job.workId,
        ref: { kind: 'job', id: jobId, attempt: 1, workId: job.workId },
      });
    } catch (error) {
      errorCode = error instanceof LlmRunError ? error.code : 'internal';
    }

    if (!errorCode && !preview) errorCode = 'invalid_output';

    const now = Date.now();
    if (errorCode) {
      deps.db
        .update(jobs)
        .set({ status: 'failed', error: errorCode, updatedAt: now })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
        .run();
      deps.bus.publish({ type: 'job.updated', workId: job.workId, jobId, status: 'failed' });
      deps.logger.record({
        level: 'warn',
        module: 'authoring',
        event: 'preview.job.failed',
        jobId,
        workId: job.workId,
        data: { code: errorCode },
      });
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
    try {
      deps.db
        .update(jobs)
        .set({
          status: 'done',
          result: { preview: completedPreview, adoption: null } as PreviewJobResult,
          updatedAt: now,
        })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
        .run();
    } catch {
      errorCode = 'save';
      deps.db
        .update(jobs)
        .set({ status: 'failed', error: 'save', updatedAt: now })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
        .run();
      deps.logger.sample({
        metric: 'preview.commit',
        durationMs: performance.now() - commitStarted,
        outcome: 'error',
        jobId,
        workId: job.workId,
      });
      deps.bus.publish({ type: 'job.updated', workId: job.workId, jobId, status: 'failed' });
      deps.logger.record({
        level: 'warn',
        module: 'authoring',
        event: 'preview.job.failed',
        jobId,
        workId: job.workId,
        data: { code: errorCode },
      });
      return;
    }

    deps.logger.sample({
      metric: 'preview.commit',
      durationMs: performance.now() - commitStarted,
      outcome: 'ok',
      jobId,
      workId: job.workId,
    });
    deps.bus.publish({ type: 'job.updated', workId: job.workId, jobId, status: 'done' });
    deps.logger.record({
      level: 'info',
      module: 'authoring',
      event: 'preview.job.done',
      jobId,
      workId: job.workId,
    });
    deps.logger.sample({
      metric: 'preview.total',
      durationMs: performance.now() - startedAt,
      outcome: 'ok',
      jobId,
      workId: job.workId,
    });
  };

  return {
    generatePreview(input): PreviewJobView {
      const result = deps.db.transaction(
        (tx) => {
          const existing = tx.select().from(jobs).where(eq(jobs.id, input.jobId)).get();
          if (existing) {
            if (existing.workId !== input.workId || existing.input.contentRev !== input.contentRev) {
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
          const background = (draft.meta as VersionMeta).background;
          if (!background.trim()) throw appError('invalid_input', 'background is empty');
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
              input: { contentRev: input.contentRev, background },
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
        void queue.add(() => runPreviewJob(input.jobId));
      }
      return result.view;
    },
    adoptPreview(input) {
      const routeId = deps.db.transaction(
        (tx) => {
          const job = tx.select().from(jobs).where(eq(jobs.id, input.jobId)).get();
          if (!job || job.workId !== input.workId) throw appError('not_found', 'preview job not found');
          if (job.result?.adoption) return job.result.adoption.routeId;
          const work = tx.select().from(works).where(eq(works.id, input.workId)).get();
          if (!work) throw appError('not_found', 'work not found');
          if (work.publishedId) throw appError('already_published', 'work is already published');
          if (job.status !== 'done' || !job.result) throw appError('preview_not_ready', 'preview is not ready');
          const draft = tx.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get();
          if (!draft) throw appError('not_found', 'draft not found');
          if (job.input.contentRev !== draft.contentRev) throw appError('stale_preview', 'preview is stale');
          const preview = job.result.preview;
          const now = Date.now();
          const nextRev = draft.contentRev + 1;
          const publishedId = randomUUID();
          const rootTurnId = randomUUID();
          const playthroughId = randomUUID();
          const adoptedRouteId = randomUUID();
          const meta: VersionMeta = {
            background: (draft.meta as VersionMeta).background,
            plan: {
              items: [{ id: PUBLIC_SETTING_PLAN_ITEM_ID, text: preview.publicSetting, source: 'ai' }],
            },
            opening: {
              prose: preview.prose,
              options: preview.options,
              scene: { ...preview.scene, present: [] },
            },
            narration: { language: preview.language },
          };
          tx.update(workVersions)
            .set({ meta, contentRev: nextRev, updatedAt: now })
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
              meta,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          tx.update(works)
            .set({ title: preview.title, blurb: preview.blurb, publishedId, updatedAt: now })
            .where(eq(works.id, work.id))
            .run();
          tx.insert(playthroughs)
            .values({ id: playthroughId, versionId: publishedId, kind: 'play', rootTurnId, createdAt: now })
            .run();
          tx.insert(turns)
            .values({
              id: rootTurnId,
              playthroughId,
              depth: 0,
              prose: meta.opening!.prose,
              options: meta.opening!.options,
              scene: meta.opening!.scene,
              status: 'committed',
              createdAt: now,
            })
            .run();
          tx.insert(routes)
            .values({
              id: adoptedRouteId,
              playthroughId,
              headTurnId: rootTurnId,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          tx.update(jobs)
            .set({ result: { preview, adoption: { versionId: publishedId, routeId: adoptedRouteId } }, updatedAt: now })
            .where(eq(jobs.id, job.id))
            .run();
          return adoptedRouteId;
        },
        { behavior: 'immediate' },
      );
      deps.bus.publish({ type: 'works.changed', workId: input.workId });
      deps.logger.record({
        level: 'info',
        module: 'authoring',
        event: 'work.adopted',
        workId: input.workId,
        jobId: input.jobId,
        data: { routeId },
      });
      return { routeId };
    },
    recoverInterrupted(): number {
      const now = Date.now();
      const recovered = deps.db.all<{ id: string; work_id: string }>(
        sql`update jobs set status = 'failed', error = 'interrupted', updated_at = ${now}
            where status = 'running' and kind = 'preview'
            returning id, work_id`,
      );
      for (const row of recovered) {
        deps.bus.publish({ type: 'job.updated', workId: row.work_id, jobId: row.id, status: 'failed' });
        deps.logger.record({
          level: 'warn',
          module: 'authoring',
          event: 'preview.job.failed',
          jobId: row.id,
          workId: row.work_id,
          data: { code: 'interrupted' },
        });
      }
      return recovered.length;
    },
    whenIdle() {
      return queue.onIdle();
    },
  };
}
