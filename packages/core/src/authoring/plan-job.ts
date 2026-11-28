import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import PQueue from 'p-queue';
import type {
  AdoptStalePlanInput,
  GeneratePlanInput,
  ImportNovelInput,
  WorkIdInput,
  PlanConflict,
  PlanItem,
  PlanJobView,
  SaveDraftOutput,
} from '@unwritten/contracts';
import { DEFAULT_WORK_SETTINGS, NOVEL_IMPORT_MAX_BYTES, NOVEL_IMPORT_PART_BYTES } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import { diagnosticFault, storageError } from '../log/fault.ts';
import type { CoreDeps, LlmService } from '../services.ts';
import { planJobView } from '../library/service.ts';
import { insertDraft } from '../store/draft.ts';
import { novelFilePath, removeNovelFile, writeNovelPart } from '../store/novel-file.ts';
import { jobs, workVersions, works } from '../store/schema.ts';
import {
  NovelSourceSchema,
  planJobParts,
  readAnchors,
  type NovelCheckpoint,
  type PlanJobInput,
  type PlanJobResult,
  type VersionMeta,
} from '../store/meta.ts';
import { readPlan, readSettings, settingsView } from '../store/plan.ts';
import type { LlmTool } from '../llm/types.ts';
import { LlmRunError } from '../llm/types.ts';
import { PLAN_SYSTEM_PROMPT, buildPlanPrompt } from './plan-prompt.ts';
import { PROPOSE_PLAN_TOOL_NAME, PROPOSE_PLAN_PARAMETERS, parsePlanArgs, sortPlanItems } from './plan-tool.ts';
import type { PlanField } from './plan-tool.ts';
import { extractNovel, indexNovelFile, NOVEL_PLAN_GUIDANCE } from './novel-import.ts';

export const PLAN_CONCURRENCY = 1;
export const PLAN_MAX_CORRECTIONS = 2;

export interface PlanJobs {
  importNovel(input: ImportNovelInput): Promise<WorkIdInput>;
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

type PlanTx = Pick<CoreDeps['db'], 'select' | 'insert'>;

function applyNovelBackground(meta: VersionMeta, input: PlanJobInput, items: PlanItem[]): VersionMeta {
  if (!input.novel || (meta.background.trim() && !meta.novelBackground)) return meta;
  const summary = items.filter((item) => item.kind === 'summary');
  const background =
    summary.find((item) => item.key === 'world')?.text ?? summary.find((item) => item.key === 'situation')?.text ?? '';
  return { ...meta, background, novelBackground: true };
}

function novelSource(tx: PlanTx, workId: string) {
  const source = tx
    .select({ input: jobs.input, result: jobs.result })
    .from(jobs)
    .where(and(eq(jobs.id, workId), eq(jobs.kind, 'novel_source')))
    .get();
  if (!source) throw appError('not_found', 'novel source not found');
  return NovelSourceSchema.parse({ ...source.input, ...source.result });
}

function insertPlanJob(tx: PlanTx, jobId: string, workId: string, input: PlanJobInput, result?: NovelCheckpoint) {
  const now = Date.now();
  return tx
    .insert(jobs)
    .values({ id: jobId, workId, kind: 'plan', status: 'running', input, result, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function createPlanJobs(
  deps: CoreDeps & { llm: LlmService },
  previewImport: (workId: string, contentRev: number) => void,
): PlanJobs {
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
            items: input.novel
              ? parsed.value.items.map((item) =>
                  input.protectedItems.some((protectedItem) => protectedItem.id === item.id)
                    ? item
                    : { ...item, source: 'ai' },
                )
              : parsed.value.items,
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

    let novelCheckpoint: NovelCheckpoint | undefined;
    let modelFault: ReturnType<typeof diagnosticFault> | undefined;
    let errorCode: PlanJobView['error'] = null;
    try {
      const prompt = buildPlanPrompt({
        background: input.background,
        anchors: readAnchors(input),
        settings: input.settings,
        protectedItems: input.protectedItems,
      });
      const novel = input.novel
        ? await extractNovel(deps, {
            jobId,
            workId: job.workId,
            source: novelSource(deps.db, job.workId),
            ...input.novel,
            checkpoint: parts.checkpoint,
            planPromptTokens: deps.llm.estimateTokens(
              prompt + PLAN_SYSTEM_PROMPT + NOVEL_PLAN_GUIDANCE + JSON.stringify(PROPOSE_PLAN_PARAMETERS),
            ),
          })
        : null;
      novelCheckpoint = novel?.checkpoint;
      await deps.llm.run({
        purpose: 'author_chat',
        system: novel ? `${PLAN_SYSTEM_PROMPT}\n${NOVEL_PLAN_GUIDANCE}` : PLAN_SYSTEM_PROMPT,
        prompt: novel ? `${prompt}\n\n${novel.prompt}` : prompt,
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
    let nextRev: number | null = null;
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
            novelCheckpoint,
          };
          if (!nextStale) {
            const meta = draft.meta as VersionMeta;
            const nextMeta: VersionMeta = {
              ...applyNovelBackground(meta, input, completed.items),
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
            nextRev: nextStale ? null : draft.contentRev + 1,
            failedJob: false,
          };
        },
        { behavior: 'immediate' },
      );
      state = committed.state;
      stale = committed.stale;
      nextRev = 'nextRev' in committed ? (committed.nextRev ?? null) : null;
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
    if (input.novel && state === 'done' && nextRev !== null && completed.conflicts.length === 0) {
      previewImport(job.workId, nextRev);
    }
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

  const notifyStarted = (jobId: string, workId: string) => {
    deps.bus.publish({ type: 'job.updated', workId, jobId, status: 'running' });
    deps.logger.record({ level: 'info', module: 'authoring', event: 'plan.job.started', jobId, workId });
    startPlanJob(jobId, workId);
  };

  const uploads = new Map<
    string,
    {
      name: string;
      totalBytes: number;
      finalize?: Promise<WorkIdInput>;
    }
  >();

  const finishUpload = async (workId: string, name: string, totalBytes: number): Promise<WorkIdInput> => {
    try {
      const source = await indexNovelFile(novelFilePath(deps.dataDir, workId), name, totalBytes);
      const jobId = deps.db.transaction(
        (tx) => {
          if (tx.select({ id: works.id }).from(works).where(eq(works.id, workId)).get()) {
            throw appError('idempotency_conflict', 'work id is already used');
          }
          insertDraft(tx, { workId, title: source.name, meta: { background: '', wizardStep: 'plan' } });
          const now = Date.now();
          const { chapters, ...sourceFile } = source;
          tx.insert(jobs)
            .values({
              id: workId,
              workId,
              kind: 'novel_source',
              status: 'done',
              input: sourceFile,
              result: { chapters },
              createdAt: now,
              updatedAt: now,
            })
            .run();
          const planId = randomUUID();
          insertPlanJob(tx, planId, workId, {
            contentRev: 0,
            background: '',
            settings: DEFAULT_WORK_SETTINGS,
            protectedItems: [],
            novel: {
              chapter: Math.max(
                0,
                chapters.findIndex((chapter) => chapter.title),
              ),
            },
          });
          return planId;
        },
        { behavior: 'immediate' },
      );
      uploads.delete(workId);
      deps.bus.publish({ type: 'works.changed', workId });
      notifyStarted(jobId, workId);
      return { workId };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'novel_invalid_text') {
        removeNovelFile(deps.dataDir, workId);
        uploads.delete(workId);
      } else {
        const upload = uploads.get(workId);
        if (upload) upload.finalize = undefined;
      }
      throw error;
    }
  };

  return {
    async importNovel(input) {
      const { workId, file, offset, totalBytes } = input;
      if (!/\.txt$/iu.test(file.name) || file.size === 0 || totalBytes === 0) {
        throw appError('novel_invalid_text', 'only nonempty TXT novels are supported');
      }
      if (totalBytes > NOVEL_IMPORT_MAX_BYTES || file.size > NOVEL_IMPORT_PART_BYTES) {
        throw appError('novel_too_large', 'novel exceeds the upload limit');
      }
      if (offset + file.size > totalBytes) throw appError('invalid_input', 'novel upload part exceeds its size');
      const name = file.name.replace(/\.txt$/iu, '').trim() || file.name;
      const bytes = Buffer.from(await file.arrayBuffer());
      const committed = deps.db.select({ id: works.id }).from(works).where(eq(works.id, workId)).get();
      if (committed) {
        const row = deps.db
          .select({ input: jobs.input })
          .from(jobs)
          .where(and(eq(jobs.id, workId), eq(jobs.kind, 'novel_source')))
          .get();
        if (!row || !('encoding' in row.input) || row.input.name !== name || row.input.size !== totalBytes) {
          throw appError('idempotency_conflict', 'work id is already used');
        }
        writeNovelPart(deps.dataDir, { workId, offset, totalBytes, bytes, committed: true });
        return { workId };
      }
      if (!deps.llm.resolve('author_chat') || !deps.llm.resolve('narrator')) {
        throw appError('llm_not_configured', 'novel import needs author_chat and narrator');
      }
      const upload = uploads.get(workId) ?? { name, totalBytes };
      if (upload.name !== name || upload.totalBytes !== totalBytes) {
        throw appError('idempotency_conflict', 'novel upload identity changed');
      }
      writeNovelPart(deps.dataDir, { workId, offset, totalBytes, bytes, committed: false });
      uploads.set(workId, upload);
      if (offset + bytes.length === totalBytes) {
        upload.finalize ??= finishUpload(workId, name, totalBytes);
        return upload.finalize;
      }
      return { workId };
    },
    generatePlan(input) {
      const result = deps.db.transaction(
        (tx) => {
          const existing = tx.select().from(jobs).where(eq(jobs.id, input.jobId)).get();
          if (existing) {
            if (existing.kind !== 'plan' || existing.workId !== input.workId) {
              throw appError('idempotency_conflict', 'job id is already used');
            }
            const parts = planJobParts(existing);
            if (
              parts.input.contentRev !== input.contentRev ||
              parts.input.novel?.chapter !== input.novelChapter ||
              parts.input.novel?.referenceChapter !== input.novelReferenceChapter
            ) {
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
          if (input.novelChapter === undefined && !background.trim()) {
            throw appError('background_required', 'background is empty');
          }
          const running = tx
            .select()
            .from(jobs)
            .where(and(eq(jobs.workId, input.workId), eq(jobs.kind, 'plan'), eq(jobs.status, 'running')))
            .get();
          if (running) throw appError('job_running', 'a plan job is already running');
          if (!deps.llm.resolve('author_chat')) throw appError('llm_not_configured', 'no author_chat model');
          if (
            input.novelReferenceChapter !== undefined &&
            (input.novelChapter === undefined || input.novelChapter === input.novelReferenceChapter)
          ) {
            throw appError('invalid_input', 'reference chapter must differ from the opening chapter');
          }
          let novel: PlanJobInput['novel'];
          let checkpoint: NovelCheckpoint | undefined;
          if (input.novelChapter !== undefined) {
            if (!deps.llm.resolve('narrator')) throw appError('llm_not_configured', 'no narrator model');
            const source = novelSource(tx, input.workId);
            if (
              input.novelChapter >= source.chapters.length ||
              (input.novelReferenceChapter ?? 0) >= source.chapters.length
            ) {
              throw appError('invalid_input', 'novel chapter not found');
            }
            novel = { chapter: input.novelChapter, referenceChapter: input.novelReferenceChapter };
            const previous = tx
              .select()
              .from(jobs)
              .where(
                and(
                  eq(jobs.workId, input.workId),
                  eq(jobs.kind, 'plan'),
                  sql`json_extract(${jobs.input}, '$.novel.chapter') = ${input.novelChapter}`,
                ),
              )
              .orderBy(desc(jobs.createdAt), sql`rowid desc`)
              .get();
            if (previous) {
              const parts = planJobParts(previous);
              checkpoint = parts.checkpoint ?? undefined;
              if (checkpoint && parts.input.novel?.referenceChapter !== novel.referenceChapter) {
                checkpoint = { ...checkpoint, evidence: undefined };
              }
            }
          }
          const items = readPlan(meta)?.items ?? [];
          const protectedItems = items.filter((item) => item.source !== 'ai');
          if (novel) {
            const referenced = new Set(
              protectedItems.flatMap((item) => (item.kind === 'secret' ? [item.subjectId, ...item.knowerIds] : [])),
            );
            protectedItems.push(...items.filter((item) => item.source === 'ai' && referenced.has(item.id)));
          }
          const row = insertPlanJob(
            tx,
            input.jobId,
            input.workId,
            {
              contentRev: input.contentRev,
              background: novel && meta.novelBackground ? '' : background,
              anchors: readAnchors(meta),
              settings: settingsView(readSettings(meta)),
              protectedItems,
              novel,
            },
            checkpoint,
          );
          return { view: planJobView(row), created: true, workId: input.workId };
        },
        { behavior: 'immediate' },
      );

      if (result.created) notifyStarted(input.jobId, result.workId);
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
                ...applyNovelBackground(meta, parts.input, items),
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
