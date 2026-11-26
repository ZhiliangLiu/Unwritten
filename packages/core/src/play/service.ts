import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import PQueue from 'p-queue';
import type {
  RetryInput,
  RouteIdInput,
  RouteView,
  SubmitActionInput,
  TurnRequestView,
  TurnView,
} from '@unwritten/contracts';
import { appError } from '../errors.ts';
import { diagnosticFault, storageError } from '../log/fault.ts';
import type { CoreDeps, LlmService, PlayService, SummaryService } from '../services.ts';
import { playthroughs, routes, turnRequests, turns, workVersions, works } from '../store/schema.ts';
import type { StoredAction, StoredScene, TurnRequestLog, VersionMeta } from '../store/meta.ts';
import type { LlmTool } from '../llm/types.ts';
import { LlmRunError } from '../llm/types.ts';
import { indexTurnProse } from '../store/prose-index.ts';
import { buildJournal } from '../story/journal.ts';
import { findLeaks } from '../story/leak.ts';
import { loadProjection, presentIdsAtHead } from '../story/projection.ts';
import { createCodeBook } from '../story/codebook.ts';
import { parseChanges } from '../story/changes.ts';
import { createStoryTools, storyToolSchemaText } from '../story/tools.ts';
import { allocateEntityIds, writeChanges } from '../story/writer.ts';
import type { ValidatedChanges } from '../story/types.ts';
import { splitParagraphs } from '../text/turn-text.ts';
import { ancestorChain, type TurnRow } from './chain.ts';
import { buildNarratorContext } from './context.ts';
import { PROPOSE_TURN_DESCRIPTION } from './narrator-prompt.ts';
import {
  PROPOSE_TURN_PARAMETERS,
  PROPOSE_TURN_TOOL_NAME,
  parseProposeTurnArgs,
  type ProposedTurnDraft,
} from './propose-turn-tool.ts';

const TURN_CONCURRENCY = 2;
const MAX_CORRECTIONS = 2;
const REQUEST_LOG_RETENTION_DAYS = 90;

function actionView(action: StoredAction | null) {
  return action ? { text: action.text, optionIndex: action.optionIndex } : { text: '', optionIndex: null };
}

function requestView(row: typeof turnRequests.$inferSelect): TurnRequestView {
  return {
    id: row.id,
    status: row.status,
    action: actionView(row.action),
    error: (row.error as TurnRequestView['error']) ?? null,
    attempts: row.attempts,
    expectedHeadTurnId: row.expectedHeadTurnId ?? row.parentTurnId ?? '',
    resultTurnId: row.resultTurnId,
    updatedAt: row.updatedAt,
  };
}

function turnView(turn: TurnRow & { originRequest: { id: string; attempt: number } | null }): TurnView {
  return {
    id: turn.id,
    originRequest: turn.originRequest,
    depth: turn.depth,
    action: turn.action ? { text: turn.action.text, optionIndex: turn.action.optionIndex } : null,
    paragraphs: splitParagraphs(turn.prose),
    options: turn.options,
    createdAt: turn.createdAt,
  };
}

export function createPlayService(deps: CoreDeps & { llm: LlmService; summary: SummaryService }): PlayService {
  const queue = new PQueue({ concurrency: TURN_CONCURRENCY });

  const getRoute = (input: RouteIdInput): RouteView => {
    const route = deps.db.select().from(routes).where(eq(routes.id, input.routeId)).get();
    if (!route) throw appError('not_found', 'route not found');
    const playthrough = deps.db.select().from(playthroughs).where(eq(playthroughs.id, route.playthroughId)).get();
    if (!playthrough) throw appError('not_found', 'playthrough not found');
    const version = deps.db.select().from(workVersions).where(eq(workVersions.id, playthrough.versionId)).get();
    if (!version) throw appError('not_found', 'version not found');
    const work = deps.db.select().from(works).where(eq(works.id, version.workId)).get();
    if (!work) throw appError('not_found', 'work not found');
    const chain = ancestorChain(deps.db, route.headTurnId);
    const pending = deps.db
      .select()
      .from(turnRequests)
      .where(
        and(
          eq(turnRequests.routeId, route.id),
          eq(turnRequests.expectedHeadTurnId, route.headTurnId),
          inArray(turnRequests.status, ['running', 'failed']),
        ),
      )
      .orderBy(desc(turnRequests.createdAt))
      .get();
    return {
      id: route.id,
      workId: work.id,
      workTitle: work.title,
      language: (version.meta as VersionMeta).narration?.language ?? 'zh-CN',
      headTurnId: route.headTurnId,
      turns: chain.map(turnView),
      pending: pending ? requestView(pending) : null,
    };
  };

  const saveFailure = (
    requestId: string,
    routeId: string,
    attempt: number,
    code: NonNullable<TurnRequestView['error']>,
    log?: TurnRequestLog,
  ) => {
    try {
      const updated = deps.db
        .update(turnRequests)
        .set({ status: 'failed', error: code, log, updatedAt: Date.now() })
        .where(and(eq(turnRequests.id, requestId), eq(turnRequests.status, 'running')))
        .run();
      if (updated.changes) deps.bus.publish({ type: 'turn_request.updated', routeId, requestId, status: 'failed' });
    } catch (error) {
      const fault = diagnosticFault(error);
      deps.logger.record({
        level: 'error',
        module: 'play',
        event: 'turn.request.failed',
        requestId,
        data: { code: storageError(fault) ?? 'save', attempt, stage: 'failure_state', ...fault },
      });
    }
  };

  const runTurnRequest = async (requestId: string, attemptStartedAt: number): Promise<void> => {
    const request = deps.db.select().from(turnRequests).where(eq(turnRequests.id, requestId)).get();
    if (!request || request.status !== 'running' || !request.routeId) return;
    deps.logger.sample({
      metric: 'turn.queue',
      durationMs: performance.now() - attemptStartedAt,
      outcome: 'ok',
      requestId,
      attempt: request.attempts,
    });
    const route = deps.db.select().from(routes).where(eq(routes.id, request.routeId)).get();
    if (!route) return;
    const playthrough = deps.db.select().from(playthroughs).where(eq(playthroughs.id, route.playthroughId)).get();
    if (!playthrough) return;
    const version = deps.db.select().from(workVersions).where(eq(workVersions.id, playthrough.versionId)).get();
    if (!version) return;
    const meta = version.meta as VersionMeta;
    const parentId = request.parentTurnId ?? route.headTurnId;
    const chain = ancestorChain(deps.db, parentId);
    const model = deps.llm.resolve('narrator');
    if (!model) {
      deps.logger.record({
        level: 'warn',
        module: 'play',
        event: 'turn.request.failed',
        requestId,
        workId: version.workId,
        data: { code: 'llm_not_configured', stage: 'configuration', attempt: request.attempts },
      });
      saveFailure(requestId, route.id, request.attempts, 'llm_not_configured');
      deps.logger.sample({
        metric: 'turn.total',
        durationMs: performance.now() - attemptStartedAt,
        outcome: 'error',
        requestId,
        attempt: request.attempts,
        data: { code: 'llm_not_configured' },
      });
      return;
    }
    const projectionStartedAt = performance.now();
    const projection = loadProjection(deps.db, {
      versionId: playthrough.versionId,
      chain: chain.map((turn) => ({
        id: turn.id,
        depth: turn.depth,
        action: turn.action,
        prose: turn.prose,
        scene: turn.scene,
      })),
    });
    deps.logger.sample({
      metric: 'story.projection',
      durationMs: performance.now() - projectionStartedAt,
      outcome: 'ok',
      requestId,
      attempt: request.attempts,
      data: {
        entities: projection.entities.size,
        facts: projection.facts.length,
        knowledge: projection.knowledge.length,
      },
    });
    const codebook = createCodeBook(projection);
    const toolSchemaText = `${storyToolSchemaText()}${JSON.stringify(PROPOSE_TURN_PARAMETERS)}${PROPOSE_TURN_DESCRIPTION}`;
    const contextStartedAt = performance.now();
    const context = buildNarratorContext({
      meta,
      projection,
      codebook,
      action: request.action ?? { text: '', optionIndex: null },
      model,
      estimateTokens: (text) => deps.llm.estimateTokens(text),
      toolSchemaText,
    });
    deps.logger.sample({
      metric: 'turn.context',
      durationMs: performance.now() - contextStartedAt,
      outcome: context.ok ? 'ok' : 'error',
      requestId,
      attempt: request.attempts,
      data: context.ok
        ? {
            includedTurns: context.includedTurns,
            omittedTurns: context.omittedTurns,
            contextTokens: context.contextTokens,
            anchorTokens: context.anchorTokens,
            indexEntities: context.indexEntities,
            summaryLines: context.summaryLines,
          }
        : { anchorTokens: context.anchorTokens },
    });
    const log: TurnRequestLog = [];
    if (!context.ok) {
      deps.logger.record({
        level: 'warn',
        module: 'play',
        event: 'turn.request.failed',
        requestId,
        workId: version.workId,
        data: { code: context.code, stage: 'context', attempt: request.attempts },
      });
      saveFailure(requestId, route.id, request.attempts, context.code, log);
      deps.logger.sample({
        metric: 'turn.total',
        durationMs: performance.now() - attemptStartedAt,
        outcome: 'error',
        requestId,
        attempt: request.attempts,
        data: { code: context.code },
      });
      return;
    }

    const proposalHolder: { value: { draft: ProposedTurnDraft; changes: ValidatedChanges } | null } = {
      value: null,
    };
    let corrections = 0;
    const parentScene = chain.at(-1)?.scene ?? { place: '', time: '', present: [], presentIds: [] };
    const proposeTool: LlmTool = {
      name: PROPOSE_TURN_TOOL_NAME,
      description: PROPOSE_TURN_DESCRIPTION,
      parameters: PROPOSE_TURN_PARAMETERS,
      async execute(args) {
        const validateStartedAt = performance.now();
        const draft = parseProposeTurnArgs(args);
        const errors = draft.ok ? [] : [...draft.errors];
        let changes: ValidatedChanges | null = null;
        if (draft.ok) {
          const parsedChanges = parseChanges(draft.value.changesRaw, {
            mode: 'turn',
            projection,
            codebook,
            paragraphCount: draft.value.paragraphs.length,
            parentPresentIds: presentIdsAtHead(projection),
          });
          if (!parsedChanges.ok) errors.push(...parsedChanges.errors);
          else {
            changes = parsedChanges.value;
            errors.push(
              ...findLeaks({
                projection,
                changes,
                paragraphs: draft.value.paragraphs,
                options: draft.value.options.map((option) => option.text),
              }),
            );
          }
        }
        deps.logger.sample({
          metric: 'turn.validate',
          durationMs: performance.now() - validateStartedAt,
          outcome: errors.length ? 'error' : 'ok',
          requestId,
          attempt: request.attempts,
        });
        log.push({ tool: PROPOSE_TURN_TOOL_NAME, ok: errors.length === 0, errors });
        if (errors.length) {
          deps.logger.record({
            level: 'info',
            module: 'play',
            event: 'turn.changes.rejected',
            requestId,
            data: { attempt: request.attempts, errorCount: errors.length },
          });
        }
        if (changes && errors.length === 0 && draft.ok) {
          proposalHolder.value = { draft: draft.value, changes };
          return { text: '已收到。', terminate: true };
        }
        corrections += 1;
        const message = errors.join('\n');
        if (corrections > MAX_CORRECTIONS) return { text: message, terminate: true };
        throw new Error(message);
      },
    };
    const tools: LlmTool[] = [
      ...createStoryTools({
        db: deps.db,
        projection,
        codebook,
        log,
        onSample: (sample) =>
          deps.logger.sample({
            metric: 'story.tool',
            durationMs: sample.durationMs,
            outcome: sample.ok ? 'ok' : 'error',
            requestId,
            attempt: request.attempts,
            data: { tool: sample.tool, records: sample.records },
          }),
      }),
      proposeTool,
    ];

    let modelFault: ReturnType<typeof diagnosticFault> | undefined;
    let errorCode: TurnRequestView['error'] = null;
    try {
      await deps.llm.run({
        purpose: 'narrator',
        system: context.system,
        prompt: context.prompt,
        tools,
        requiredToolName: PROPOSE_TURN_TOOL_NAME,
        sessionId: route.id,
        ref: { kind: 'turn_request', id: requestId, attempt: request.attempts, workId: version.workId },
      });
    } catch (error) {
      if (error instanceof LlmRunError) {
        errorCode = error.code;
      } else {
        modelFault = diagnosticFault(error);
        errorCode = storageError(modelFault) ?? 'internal';
      }
    }

    const proposal = proposalHolder.value;
    if (!errorCode && !proposal) errorCode = 'invalid_output';
    const now = Date.now();
    if (errorCode) {
      deps.logger.record({
        level: 'warn',
        module: 'play',
        event: 'turn.request.failed',
        requestId,
        data: {
          attempt: request.attempts,
          code: errorCode,
          stage: errorCode === 'invalid_output' && corrections > 0 ? 'validation' : 'model',
          corrections,
          ...modelFault,
        },
      });
      saveFailure(requestId, route.id, request.attempts, errorCode, log);
      deps.logger.sample({
        metric: 'turn.total',
        durationMs: performance.now() - attemptStartedAt,
        outcome: errorCode === 'interrupted' ? 'interrupted' : 'error',
        requestId,
        attempt: request.attempts,
        data: { code: errorCode },
      });
      return;
    }

    if (!proposal) return;
    const commitStartedAt = performance.now();
    let committed: { superseded: boolean; turnId: string | null };
    try {
      committed = deps.db.transaction(
        (tx) => {
          const current = tx.select().from(routes).where(eq(routes.id, route.id)).get();
          if (!current || current.headTurnId !== request.expectedHeadTurnId) {
            tx.update(turnRequests)
              .set({ status: 'superseded', log, updatedAt: now })
              .where(and(eq(turnRequests.id, requestId), eq(turnRequests.status, 'running')))
              .run();
            return { superseded: true, turnId: null };
          }
          const parent = tx.select().from(turns).where(eq(turns.id, parentId)).get();
          if (!parent) throw new Error('parent turn disappeared');
          const createdIds = allocateEntityIds(proposal.changes);
          const scene: StoredScene = proposal.changes.scene
            ? {
                place: proposal.changes.scene.place,
                time: proposal.changes.scene.time,
                present: proposal.changes.scene.present.map((ref) =>
                  'created' in ref
                    ? (proposal.changes.entities.find((entity) => entity.line === ref.created)?.name ?? '')
                    : (projection.entities.get(ref.existing)?.name ?? ''),
                ),
                presentIds: proposal.changes.scene.present.map((ref) =>
                  'created' in ref ? (createdIds.get(ref.created) ?? '') : ref.existing,
                ),
              }
            : parentScene;
          const turnId = randomUUID();
          tx.insert(turns)
            .values({
              id: turnId,
              playthroughId: route.playthroughId,
              parentId,
              depth: parent.depth + 1,
              action: request.action,
              prose: proposal.draft.prose,
              options: proposal.draft.options,
              scene,
              ending: 0,
              status: 'committed',
              createdAt: now,
            })
            .run();
          writeChanges(tx, {
            changes: proposal.changes,
            createdIds,
            turnId,
            versionId: playthrough.versionId,
            entityVersionIds: [playthrough.versionId],
            entityOrigin: 'turn',
            protagonistId: projection.protagonistId,
            parentPresentIds: presentIdsAtHead(projection),
          });
          indexTurnProse(tx, turnId, proposal.draft.prose);
          const routeUpdate = tx
            .update(routes)
            .set({ headTurnId: turnId, updatedAt: now, draftInput: null })
            .where(and(eq(routes.id, route.id), eq(routes.headTurnId, request.expectedHeadTurnId ?? '')))
            .run();
          if (routeUpdate.changes !== 1) throw new Error('route head changed');
          const requestUpdate = tx
            .update(turnRequests)
            .set({ status: 'done', resultTurnId: turnId, log, updatedAt: now })
            .where(and(eq(turnRequests.id, requestId), eq(turnRequests.status, 'running')))
            .run();
          if (requestUpdate.changes !== 1) throw new Error('request is no longer running');
          return { superseded: false, turnId };
        },
        { behavior: 'immediate' },
      );
    } catch (error) {
      const fault = diagnosticFault(error);
      const code = storageError(fault) ?? 'save';
      deps.logger.sample({
        metric: 'turn.commit',
        durationMs: performance.now() - commitStartedAt,
        outcome: 'error',
        requestId,
        attempt: request.attempts,
        data: { code },
      });
      deps.logger.record({
        level: 'error',
        module: 'play',
        event: 'turn.request.failed',
        workId: version.workId,
        requestId,
        data: { attempt: request.attempts, code, stage: 'commit', ...fault },
      });
      saveFailure(requestId, route.id, request.attempts, code, log);
      deps.logger.sample({
        metric: 'turn.total',
        durationMs: performance.now() - attemptStartedAt,
        outcome: 'error',
        requestId,
        attempt: request.attempts,
        data: { code },
      });
      return;
    }

    if (committed.superseded) {
      deps.bus.publish({ type: 'turn_request.updated', routeId: route.id, requestId, status: 'superseded' });
      deps.logger.record({
        level: 'info',
        module: 'play',
        event: 'turn.request.superseded',
        requestId,
        data: { attempt: request.attempts },
      });
      deps.logger.sample({
        metric: 'turn.commit',
        durationMs: performance.now() - commitStartedAt,
        outcome: 'interrupted',
        requestId,
        attempt: request.attempts,
      });
      deps.logger.sample({
        metric: 'turn.total',
        durationMs: performance.now() - attemptStartedAt,
        outcome: 'interrupted',
        requestId,
        attempt: request.attempts,
      });
      return;
    }
    deps.logger.sample({
      metric: 'turn.commit',
      durationMs: performance.now() - commitStartedAt,
      outcome: 'ok',
      requestId,
      attempt: request.attempts,
    });
    deps.bus.publish({ type: 'turn.committed', routeId: route.id, turnId: committed.turnId! });
    deps.bus.publish({ type: 'turn_request.updated', routeId: route.id, requestId, status: 'done' });
    if (committed.turnId) deps.summary.enqueue(committed.turnId, route.id);
    deps.logger.record({
      level: 'info',
      module: 'play',
      event: 'turn.request.done',
      requestId,
      data: { attempt: request.attempts, turnId: committed.turnId },
    });
    deps.logger.sample({
      metric: 'turn.total',
      durationMs: performance.now() - attemptStartedAt,
      outcome: 'ok',
      requestId,
      attempt: request.attempts,
    });
  };

  const startTurnRequest = (requestId: string, routeId: string, attempt: number) => {
    const startedAt = performance.now();
    void queue.add(() =>
      runTurnRequest(requestId, startedAt).catch((error: unknown) => {
        const fault = diagnosticFault(error);
        const code = storageError(fault) ?? 'internal';
        deps.logger.record({
          level: 'error',
          module: 'play',
          event: 'turn.request.failed',
          requestId,
          data: { code, attempt, stage: 'background', ...fault },
        });
        saveFailure(requestId, routeId, attempt, code);
        deps.logger.sample({
          metric: 'turn.total',
          durationMs: performance.now() - startedAt,
          outcome: 'error',
          requestId,
          attempt,
          data: { code },
        });
      }),
    );
  };

  return {
    getRoute,
    getJournal(input) {
      const route = deps.db.select().from(routes).where(eq(routes.id, input.routeId)).get();
      if (!route) throw appError('not_found', 'route not found');
      const playthrough = deps.db.select().from(playthroughs).where(eq(playthroughs.id, route.playthroughId)).get();
      if (!playthrough) throw appError('not_found', 'playthrough not found');
      const chain = ancestorChain(deps.db, route.headTurnId);
      const projection = loadProjection(deps.db, {
        versionId: playthrough.versionId,
        chain: chain.map((turn) => ({
          id: turn.id,
          depth: turn.depth,
          action: turn.action,
          prose: turn.prose,
          scene: turn.scene,
        })),
      });
      return buildJournal(projection, route.id);
    },
    submitAction(input: SubmitActionInput): TurnRequestView {
      const result = deps.db.transaction(
        (tx) => {
          const existing = tx.select().from(turnRequests).where(eq(turnRequests.id, input.requestId)).get();
          if (existing) {
            const same =
              existing.routeId === input.routeId &&
              existing.expectedHeadTurnId === input.expectedHeadTurnId &&
              existing.action?.text === input.action.text &&
              existing.action.optionIndex === input.action.optionIndex;
            if (!same) throw appError('idempotency_conflict', 'request id is already used');
            return { view: requestView(existing), created: false, routeId: input.routeId };
          }
          const route = tx.select().from(routes).where(eq(routes.id, input.routeId)).get();
          if (!route) throw appError('not_found', 'route not found');
          if (route.headTurnId !== input.expectedHeadTurnId) throw appError('stale_head', 'route head moved');
          if (input.action.optionIndex !== null) {
            const head = tx.select().from(turns).where(eq(turns.id, route.headTurnId)).get();
            const option = head?.options[input.action.optionIndex - 1];
            if (!option || option.text !== input.action.text) throw appError('option_mismatch', 'option changed');
          }
          const active = tx
            .select()
            .from(turnRequests)
            .where(
              and(eq(turnRequests.routeId, route.id), inArray(turnRequests.status, ['running', 'needs_clarification'])),
            )
            .get();
          if (active) throw appError('request_in_progress', 'another request is running');
          if (!deps.llm.resolve('narrator')) throw appError('llm_not_configured', 'no narrator model');
          const now = Date.now();
          tx.insert(turnRequests)
            .values({
              id: input.requestId,
              playthroughId: route.playthroughId,
              routeId: route.id,
              kind: 'continue',
              expectedHeadTurnId: route.headTurnId,
              parentTurnId: route.headTurnId,
              action: input.action,
              status: 'running',
              attempts: 1,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          const row = tx.select().from(turnRequests).where(eq(turnRequests.id, input.requestId)).get();
          return { view: requestView(row!), created: true, routeId: route.id };
        },
        { behavior: 'immediate' },
      );
      if (result.created) {
        deps.bus.publish({
          type: 'turn_request.updated',
          routeId: result.routeId,
          requestId: input.requestId,
          status: 'running',
        });
        deps.logger.record({
          level: 'info',
          module: 'play',
          event: 'turn.request.submitted',
          requestId: input.requestId,
          data: { attempt: 1 },
        });
        startTurnRequest(input.requestId, result.routeId, result.view.attempts);
      }
      return result.view;
    },
    retry(input: RetryInput): TurnRequestView {
      const result = deps.db.transaction(
        (tx) => {
          const request = tx.select().from(turnRequests).where(eq(turnRequests.id, input.requestId)).get();
          if (!request) throw appError('not_found', 'request not found');
          if (request.status === 'running')
            return { view: requestView(request), action: 'none' as const, routeId: request.routeId };
          if (request.status !== 'failed') throw appError('request_not_retryable', 'request is not failed');
          const route = request.routeId ? tx.select().from(routes).where(eq(routes.id, request.routeId)).get() : null;
          if (!route) throw appError('not_found', 'route not found');
          if (route.headTurnId !== request.expectedHeadTurnId) {
            tx.update(turnRequests)
              .set({ status: 'superseded', updatedAt: Date.now() })
              .where(eq(turnRequests.id, request.id))
              .run();
            const row = tx.select().from(turnRequests).where(eq(turnRequests.id, request.id)).get();
            return { view: requestView(row!), action: 'superseded' as const, routeId: route.id };
          }
          const active = tx
            .select()
            .from(turnRequests)
            .where(and(eq(turnRequests.routeId, route.id), eq(turnRequests.status, 'running')))
            .get();
          if (active) throw appError('request_in_progress', 'another request is running');
          if (!deps.llm.resolve('narrator')) throw appError('llm_not_configured', 'no narrator model');
          tx.update(turnRequests)
            .set({ status: 'running', attempts: request.attempts + 1, error: null, updatedAt: Date.now() })
            .where(eq(turnRequests.id, request.id))
            .run();
          const row = tx.select().from(turnRequests).where(eq(turnRequests.id, request.id)).get();
          return { view: requestView(row!), action: 'retry' as const, routeId: route.id };
        },
        { behavior: 'immediate' },
      );
      if (result.action === 'retry') {
        deps.bus.publish({
          type: 'turn_request.updated',
          routeId: result.routeId!,
          requestId: input.requestId,
          status: 'running',
        });
        deps.logger.record({
          level: 'info',
          module: 'play',
          event: 'turn.request.submitted',
          requestId: input.requestId,
          data: { attempt: result.view.attempts },
        });
        startTurnRequest(input.requestId, result.routeId, result.view.attempts);
      } else if (result.action === 'superseded') {
        deps.bus.publish({
          type: 'turn_request.updated',
          routeId: result.routeId!,
          requestId: input.requestId,
          status: 'superseded',
        });
      }
      return result.view;
    },
    recoverInterrupted(): number {
      const recovered = deps.db.all<{ id: string; attempts: number }>(
        sql`update turn_requests set status = 'failed', error = 'interrupted', log = null, updated_at = ${Date.now()}
            where status = 'running' returning id, attempts`,
      );
      for (const row of recovered) {
        deps.logger.record({
          level: 'warn',
          module: 'play',
          event: 'turn.request.failed',
          requestId: row.id,
          data: { attempt: row.attempts, code: 'interrupted' },
        });
      }
      return recovered.length;
    },
    pruneOldRequestLogs(): number {
      const cutoff = Date.now() - REQUEST_LOG_RETENTION_DAYS * 86_400_000;
      const result = deps.db.run(
        sql`update turn_requests set log = null where created_at < ${cutoff} and log is not null`,
      );
      return Number(result.changes ?? 0);
    },
    whenIdle() {
      return queue.onIdle();
    },
  };
}
