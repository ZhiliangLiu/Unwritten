import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import PQueue from 'p-queue';
import type {
  AdoptStalePlanInput,
  GeneratePlanInput,
  PlanConflict,
  PlanItem,
  PlanJobView,
  SaveDraftOutput,
} from '@unwritten/contracts';
import { appError } from '../errors.ts';
import { diagnosticFault, storageError } from '../log/fault.ts';
import type { CoreDeps, LlmService } from '../services.ts';
import { planJobView } from '../library/service.ts';
import { jobs, workVersions, works } from '../store/schema.ts';
import { planJobParts, readAnchors, type PlanJobResult, type VersionMeta } from '../store/meta.ts';
import { readPlan, readSettings, settingsView } from '../store/plan.ts';
import type { LlmTool } from '../llm/types.ts';
import { LlmRunError } from '../llm/types.ts';
import { PLAN_SYSTEM_PROMPT, buildPlanPrompt } from './plan-prompt.ts';
import { PROPOSE_PLAN_TOOL_NAME, PROPOSE_PLAN_PARAMETERS, parsePlanArgs, sortPlanItems } from './plan-tool.ts';
import type { PlanField } from './plan-tool.ts';

export const PLAN_CONCURRENCY = 1;
export const PLAN_MAX_CORRECTIONS = 2;

export interface PlanJobs {
  generatePlan(input: GeneratePlanInput): PlanJobView;
  adoptStalePlan(input: AdoptStalePlanInput): SaveDraftOutput;
  recover(): number;
  whenIdle(): Promise<void>;
}

function duplicatesProtected(item: PlanItem, protectedItems: PlanItem[]): boolean {
  switch (item.kind) {
    case 'summary':
      return protectedItems.some((candidate) => candidate.kind === 'summary' && candidate.key === item.key);
    case 'entity':
      return protectedItems.some(
        (candidate) =>
          candidate.kind === 'entity' && candidate.entityKind === item.entityKind && candidate.name === item.name,
      );
    case 'state':
      return protectedItems.some((candidate) => candidate.kind === 'state' && candidate.key === item.key);
    case 'ending':
      return protectedItems.some((candidate) => candidate.kind === 'ending');
    default:
      return false;
  }
}

export function createPlanJobs(deps: CoreDeps & { llm: LlmService }): PlanJobs {
  const queue = new PQueue({ concurrency: PLAN_CONCURRENCY });

  const saveFailure = (jobId: string, workId: string, code: NonNullable<PlanJobView['error']>) => {
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
        event: 'plan.job.failed',
        jobId,
        workId,
        data: { code: storageError(fault) ?? 'save', stage: 'failure_state', ...fault },
      });
    }
  };

  const runPlanJob = async (jobId: string, startedAt: number): Promise<void> => {
    const job = deps.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job || job.status !== 'running') return;
    const parts = planJobParts(job);
    const input = parts.input;
    deps.logger.sample({
      metric: 'plan.queue',
      durationMs: performance.now() - startedAt,
      outcome: 'ok',
      jobId,
      workId: job.workId,
    });

    const planHolder: { value: { items: PlanItem[]; conflicts: PlanConflict[]; language: string } | null } = {
      value: null,
    };
    let corrections = 0;
    const rejected: { last: { errorCount: number; fields: PlanField[] } | null } = { last: null };
    const tool: LlmTool = {
      name: PROPOSE_PLAN_TOOL_NAME,
      description: '提交故事方案：摘要、人物与事物、秘密、状态栏、关键场面、结束条件和冲突。',
      parameters: PROPOSE_PLAN_PARAMETERS,
      async execute(args) {
        const started = performance.now();
        const parsed = parsePlanArgs(args, {
          castMode: input.settings.cast.mode,
          protectedItems: input.protectedItems,
          authorTexts: [
            input.background,
            input.anchors?.narrationDirective ?? '',
            input.anchors?.contentPolicy ?? '',
            input.anchors?.improvisationScope ?? '',
            input.settings.world.text,
            input.settings.protagonist.text,
            input.settings.cast.text,
            input.settings.secrets.text,
            input.settings.opening.text,
            input.settings.actions.text,
            input.settings.scenes.text,
            input.settings.status.text,
          ],
          newId: randomUUID,
        });
        const failure = parsed.ok ? null : { errorCount: parsed.errors.length, fields: parsed.fields };
        if (failure) rejected.last = failure;
        deps.logger.sample({
          metric: 'plan.validate',
          durationMs: performance.now() - started,
          outcome: parsed.ok ? 'ok' : 'error',
          jobId,
          workId: job.workId,
          data: failure ?? undefined,
        });
        if (parsed.ok) {
          planHolder.value = {
            items: parsed.value.items,
            conflicts: parsed.value.conflicts,
            language: parsed.value.language,
          };
          return { text: '已收到。', terminate: true };
        }
        corrections += 1;
        const message = parsed.errors.join('\n');
        if (corrections > PLAN_MAX_CORRECTIONS) return { text: message, terminate: true };
        throw new Error(message);
      },
    };

    let modelFault: ReturnType<typeof diagnosticFault> | undefined;
    let errorCode: PlanJobView['error'] = null;
    try {
      await deps.llm.run({
        purpose: 'author_chat',
        system: PLAN_SYSTEM_PROMPT,
        prompt: buildPlanPrompt({
          background: input.background,
          anchors: readAnchors(input),
          settings: input.settings,
          protectedItems: input.protectedItems,
        }),
        tools: [tool],
        requiredToolName: PROPOSE_PLAN_TOOL_NAME,
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

    if (!errorCode && !planHolder.value) errorCode = 'invalid_output';

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
        event: 'plan.job.failed',
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
        metric: 'plan.total',
        durationMs: performance.now() - startedAt,
        outcome: errorCode === 'interrupted' ? 'interrupted' : 'error',
        jobId,
        workId: job.workId,
      });
      return;
    }

    if (!planHolder.value) return;
    const completed = planHolder.value;
    const commitStarted = performance.now();
    let state: 'done' | 'interrupted' | 'error' = 'error';
    let stale = false;
    let failedJob = false;
    try {
      const committed = deps.db.transaction(
        (tx) => {
          const current = tx.select().from(jobs).where(eq(jobs.id, jobId)).get();
          if (!current || current.status !== 'running') {
            return { state: 'interrupted' as const, stale: false, failedJob: false };
          }
          const work = tx.select().from(works).where(eq(works.id, job.workId)).get();
          const draft = work ? tx.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get() : null;
          if (!work || !draft) {
            const marked = tx
              .update(jobs)
              .set({ status: 'failed', error: 'interrupted', updatedAt: now })
              .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
              .run();
            return { state: 'interrupted' as const, stale: false, failedJob: marked.changes !== 0 };
          }
          const nextStale = draft.contentRev !== input.contentRev;
          const result: PlanJobResult = {
            items: completed.items,
            conflicts: completed.conflicts,
            language: completed.language,
            stale: nextStale,
          };
          if (!nextStale) {
            const meta = draft.meta as VersionMeta;
            const nextMeta: VersionMeta = {
              ...meta,
              plan: { items: completed.items, conflicts: completed.conflicts, confirmedRev: null },
              narration: meta.narration ?? { language: completed.language },
              wizardStep: 'plan',
            };
            tx.update(workVersions)
              .set({ meta: nextMeta, contentRev: draft.contentRev + 1, updatedAt: now })
              .where(eq(workVersions.id, draft.id))
              .run();
          }
          const updated = tx
            .update(jobs)
            .set({ status: 'done', result, updatedAt: now })
            .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
            .run();
          return {
            state: updated.changes ? ('done' as const) : ('interrupted' as const),
            stale: nextStale,
            failedJob: false,
          };
        },
        { behavior: 'immediate' },
      );
      state = committed.state;
      stale = committed.stale;
      failedJob = committed.failedJob;
    } catch (error) {
      const fault = diagnosticFault(error);
      errorCode = storageError(fault) ?? 'save';
      deps.logger.sample({
        metric: 'plan.commit',
        durationMs: performance.now() - commitStarted,
        outcome: 'error',
        jobId,
        workId: job.workId,
      });
      deps.logger.record({
        level: 'error',
        module: 'authoring',
        event: 'plan.job.failed',
        jobId,
        workId: job.workId,
        data: { code: errorCode, stage: 'commit', ...fault },
      });
      saveFailure(jobId, job.workId, errorCode);
      deps.logger.sample({
        metric: 'plan.total',
        durationMs: performance.now() - startedAt,
        outcome: 'error',
        jobId,
        workId: job.workId,
      });
      return;
    }

    deps.logger.sample({
      metric: 'plan.commit',
      durationMs: performance.now() - commitStarted,
      outcome: state === 'done' ? 'ok' : 'interrupted',
      jobId,
      workId: job.workId,
    });
    if (state === 'done') {
      deps.bus.publish({ type: 'job.updated', workId: job.workId, jobId, status: 'done' });
      if (!stale) deps.bus.publish({ type: 'works.changed', workId: job.workId });
      deps.logger.record({
        level: 'info',
        module: 'authoring',
        event: 'plan.job.done',
        jobId,
        workId: job.workId,
        data: { items: completed.items.length, conflicts: completed.conflicts.length, stale },
      });
    } else {
      if (failedJob) deps.bus.publish({ type: 'job.updated', workId: job.workId, jobId, status: 'failed' });
      deps.logger.record({
        level: 'info',
        module: 'authoring',
        event: 'plan.job.interrupted',
        jobId,
        workId: job.workId,
      });
    }
    deps.logger.sample({
      metric: 'plan.total',
      durationMs: performance.now() - startedAt,
      outcome: state === 'done' ? 'ok' : 'interrupted',
      jobId,
      workId: job.workId,
      data: { items: completed.items.length },
    });
  };

  const failBackgroundJob = (jobId: string, workId: string, startedAt: number, error: unknown) => {
    const fault = diagnosticFault(error);
    const code = storageError(fault) ?? 'internal';
    deps.logger.record({
      level: 'error',
      module: 'authoring',
      event: 'plan.job.failed',
      jobId,
      workId,
      data: { code, stage: 'background', ...fault },
    });
    deps.logger.sample({
      metric: 'plan.total',
      durationMs: performance.now() - startedAt,
      outcome: 'error',
      jobId,
      workId,
    });
    saveFailure(jobId, workId, code);
  };

  const startPlanJob = (jobId: string, workId: string) => {
    const startedAt = performance.now();
    void queue.add(() =>
      runPlanJob(jobId, startedAt).catch((error: unknown) => failBackgroundJob(jobId, workId, startedAt, error)),
    );
  };

  return {
    generatePlan(input) {
      const result = deps.db.transaction(
        (tx) => {
          const existing = tx.select().from(jobs).where(eq(jobs.id, input.jobId)).get();
          if (existing) {
            if (existing.kind !== 'plan' || existing.workId !== input.workId) {
              throw appError('idempotency_conflict', 'job id is already used');
            }
            const parts = planJobParts(existing);
            if (parts.input.contentRev !== input.contentRev) {
              throw appError('idempotency_conflict', 'job id is already used');
            }
            return { view: planJobView(existing), created: false, workId: existing.workId };
          }
          const work = tx.select().from(works).where(eq(works.id, input.workId)).get();
          if (!work) throw appError('not_found', 'work not found');
          const draft = tx.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get();
          if (!draft) throw appError('not_found', 'draft not found');
          if (draft.contentRev !== input.contentRev) throw appError('stale_revision', 'draft revision is stale');
          const meta = draft.meta as VersionMeta;
          const background = meta.background;
          if (!background.trim()) throw appError('background_required', 'background is empty');
          const running = tx
            .select()
            .from(jobs)
            .where(and(eq(jobs.workId, input.workId), eq(jobs.kind, 'plan'), eq(jobs.status, 'running')))
            .get();
          if (running) throw appError('job_running', 'a plan job is already running');
          if (!deps.llm.resolve('author_chat')) throw appError('llm_not_configured', 'no author_chat model');
          const now = Date.now();
          tx.insert(jobs)
            .values({
              id: input.jobId,
              workId: input.workId,
              kind: 'plan',
              status: 'running',
              input: {
                contentRev: input.contentRev,
                background,
                anchors: readAnchors(meta),
                settings: settingsView(readSettings(meta)),
                protectedItems: readPlan(meta)?.items.filter((item) => item.source !== 'ai') ?? [],
              },
              createdAt: now,
              updatedAt: now,
            })
            .run();
          const row = tx.select().from(jobs).where(eq(jobs.id, input.jobId)).get();
          return { view: planJobView(row!), created: true, workId: input.workId };
        },
        { behavior: 'immediate' },
      );

      if (result.created) {
        deps.bus.publish({ type: 'job.updated', workId: result.workId, jobId: input.jobId, status: 'running' });
        deps.logger.record({
          level: 'info',
          module: 'authoring',
          event: 'plan.job.started',
          jobId: input.jobId,
          workId: result.workId,
        });
        startPlanJob(input.jobId, result.workId);
      }
      return result.view;
    },
    adoptStalePlan(input) {
      const adopted = deps.db.transaction(
        (tx) => {
          const job = tx.select().from(jobs).where(eq(jobs.id, input.jobId)).get();
          if (!job || job.workId !== input.workId || job.kind !== 'plan') {
            throw appError('not_found', 'plan job not found');
          }
          const parts = planJobParts(job);
          if (job.status !== 'done' || !parts.result || !parts.result.stale) {
            throw appError('stale_revision', 'plan job is not stale');
          }
          const work = tx.select().from(works).where(eq(works.id, input.workId)).get();
          if (!work) throw appError('not_found', 'work not found');
          const draft = tx.select().from(workVersions).where(eq(workVersions.id, work.draftId)).get();
          if (!draft) throw appError('not_found', 'draft not found');
          const meta = draft.meta as VersionMeta;
          const protectedNow = readPlan(meta)?.items.filter((item) => item.source !== 'ai') ?? [];
          const items = sortPlanItems([
            ...protectedNow,
            ...parts.result.items.filter((item) => !duplicatesProtected(item, protectedNow)),
          ]);
          const nextRev = draft.contentRev + 1;
          const now = Date.now();
          tx.update(workVersions)
            .set({
              meta: {
                ...meta,
                plan: { items, conflicts: parts.result.conflicts, confirmedRev: null },
                wizardStep: 'plan',
              },
              contentRev: nextRev,
              updatedAt: now,
            })
            .where(eq(workVersions.id, draft.id))
            .run();
          tx.update(jobs)
            .set({ result: { ...parts.result, stale: false }, updatedAt: now })
            .where(eq(jobs.id, job.id))
            .run();
          return { contentRev: nextRev, items: items.length };
        },
        { behavior: 'immediate' },
      );
      deps.bus.publish({ type: 'works.changed', workId: input.workId });
      deps.logger.record({
        level: 'info',
        module: 'authoring',
        event: 'plan.adopted_stale',
        workId: input.workId,
        jobId: input.jobId,
        data: { items: adopted.items },
      });
      return { contentRev: adopted.contentRev };
    },
    recover() {
      return 0;
    },
    whenIdle() {
      return queue.onIdle();
    },
  };
}
