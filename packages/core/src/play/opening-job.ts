import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import PQueue from 'p-queue';
import type { PlaythroughView, RetryOpeningInput } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import { diagnosticFault, storageError } from '../log/fault.ts';
import type { CoreDeps, LlmService } from '../services.ts';
import { playthroughs, routes, turnRequests, turns, workVersions } from '../store/schema.ts';
import type { StoredScene, TurnRequestLog, VersionMeta } from '../store/meta.ts';
import { readSettings } from '../store/plan.ts';
import type { LlmTool } from '../llm/types.ts';
import { LlmRunError } from '../llm/types.ts';
import { indexTurnProse } from '../store/prose-index.ts';
import { substitutePlaceholders } from '../text/placeholders.ts';
import { createCodeBook } from '../story/codebook.ts';
import type { OpeningProposal, OpeningProposalContext } from '../story/opening-proposal.ts';
import { parseOpeningProposal } from '../story/opening-proposal.ts';
import { loadProjection } from '../story/projection.ts';
import { allocateEntityIds, writeChanges, writeStateValues } from '../story/writer.ts';
import { PROPOSE_CAST_PARAMETERS, PROPOSE_CAST_TOOL_NAME, parseCastArgs, type CastMember } from './cast-tool.ts';
import { PROPOSE_OPENING_DESCRIPTION, PROPOSE_OPENING_PARAMETERS, PROPOSE_OPENING_TOOL_NAME } from './opening-tool.ts';
import { CAST_SYSTEM_PROMPT, OPENING_SYSTEM_PROMPT, buildCastPrompt, buildOpeningPrompt } from './opening-prompt.ts';
import { playthroughView, writeProtagonistName } from './start.ts';

const MAX_CORRECTIONS = 2;

export interface OpeningJobs {
  enqueue(requestId: string): void;
  retry(input: RetryOpeningInput): PlaythroughView;
  whenIdle(): Promise<void>;
}

function proposalScene(
  proposal: OpeningProposal,
  entitiesById: Map<string, { name: string }>,
  createdIds: Map<number, string>,
): StoredScene {
  const scene = proposal.changes.scene ?? { place: '', time: '', present: [] };
  return {
    place: scene.place,
    time: scene.time,
    present: scene.present.map((ref) =>
      'created' in ref
        ? (proposal.changes.entities.find((entity) => entity.line === ref.created)?.name ?? '')
        : (entitiesById.get(ref.existing)?.name ?? ''),
    ),
    presentIds: scene.present.map((ref) => ('created' in ref ? (createdIds.get(ref.created) ?? '') : ref.existing)),
  };
}

export function createOpeningJobs(deps: CoreDeps & { llm: LlmService }): OpeningJobs {
  const queue = new PQueue({ concurrency: 1 });

  const publishFinished = (playthroughId: string, requestId: string, status: 'failed' | 'done' | 'superseded') => {
    deps.bus.publish({ type: 'playthrough.updated', playthroughId, requestId, status });
  };

  const saveFailure = (
    requestId: string,
    playthroughId: string,
    attempt: number,
    code: NonNullable<PlaythroughView['opening']>['error'],
    log?: TurnRequestLog,
  ) => {
    try {
      const updated = deps.db
        .update(turnRequests)
        .set({ status: 'failed', error: code, log, updatedAt: Date.now() })
        .where(and(eq(turnRequests.id, requestId), eq(turnRequests.status, 'running')))
        .run();
      if (updated.changes) publishFinished(playthroughId, requestId, 'failed');
    } catch (error) {
      const fault = diagnosticFault(error);
      deps.logger.record({
        level: 'error',
        module: 'play',
        event: 'opening.request.failed',
        requestId,
        data: { code: storageError(fault) ?? 'save', attempt, stage: 'failure_state', ...fault },
      });
    }
  };

  const run = async (requestId: string, startedAt: number): Promise<void> => {
    const request = deps.db.select().from(turnRequests).where(eq(turnRequests.id, requestId)).get();
    if (!request || request.kind !== 'opening' || request.status !== 'running') return;
    const attempt = request.attempts;
    const playthroughId = request.playthroughId;
    deps.logger.sample({
      metric: 'opening.queue',
      durationMs: performance.now() - startedAt,
      outcome: 'ok',
      requestId,
      attempt,
    });

    const playthrough = deps.db.select().from(playthroughs).where(eq(playthroughs.id, playthroughId)).get();
    if (!playthrough) return;
    const version = deps.db.select().from(workVersions).where(eq(workVersions.id, playthrough.versionId)).get();
    if (!version) return;
    const workId = version.workId;
    const meta = version.meta as VersionMeta;
    const settings = readSettings(meta);
    const opening = meta.opening;
    const log: TurnRequestLog = [];

    const fail = (
      code: NonNullable<PlaythroughView['opening']>['error'],
      stage: 'cast' | 'opening' | 'validation' | 'commit',
      fault?: Record<string, unknown>,
    ) => {
      deps.logger.record({
        level: 'warn',
        module: 'play',
        event: 'opening.request.failed',
        requestId,
        workId,
        data: { attempt, code, stage, ...fault },
      });
      saveFailure(requestId, playthroughId, attempt, code, log);
      deps.logger.sample({
        metric: 'opening.total',
        durationMs: performance.now() - startedAt,
        outcome: 'error',
        requestId,
        attempt,
        data: { code },
      });
    };

    if (!deps.llm.resolve('narrator')) {
      fail('llm_not_configured', 'opening');
      return;
    }
    if (!opening) {
      fail('internal', 'opening');
      return;
    }

    const projection = loadProjection(deps.db, { versionId: playthrough.versionId, chain: [] });
    const codebook = createCodeBook(projection);
    const protagonistValues = (playthrough.protagonist as Record<string, string> | null) ?? {};
    const nameField = settings.protagonist.fields.find((field) => field.isName);
    const protagonistName =
      (nameField ? protagonistValues[nameField.name]?.trim() : null) ||
      projection.entities.get(projection.protagonistId)?.name ||
      '';
    const roleById = new Map((meta.castSlots ?? []).map((slot) => [slot.id, slot.role]));
    let cast = playthrough.cast as CastMember[] | null;

    if (!cast || cast.length === 0) {
      const castStartedAt = performance.now();
      const slots = (meta.castSlots ?? []).map((slot, index) => ({
        index: String(index + 1),
        slotId: slot.id,
        role: slot.role,
      }));
      const takenNames = [
        ...new Set([
          ...[...projection.entities.values()]
            .filter((entity) => entity.kind === 'character')
            .map((entity) => entity.name),
          ...projection.names
            .filter((name) => projection.entities.get(name.entityId)?.kind === 'character')
            .map((name) => name.name),
        ]),
      ];
      const holder: { value: CastMember[] | null } = { value: null };
      let corrections = 0;
      const tool: LlmTool = {
        name: PROPOSE_CAST_TOOL_NAME,
        description: '提交这一局的主要人物，每个人物位置一行。',
        parameters: PROPOSE_CAST_PARAMETERS,
        async execute(args) {
          const parsed = parseCastArgs(args, { slots, takenNames });
          log.push({ tool: PROPOSE_CAST_TOOL_NAME, ok: parsed.ok, errors: parsed.ok ? [] : parsed.errors });
          if (parsed.ok) {
            holder.value = parsed.value;
            return { text: '已收到。', terminate: true };
          }
          corrections += 1;
          const message = parsed.errors.join('\n');
          if (corrections > MAX_CORRECTIONS) return { text: message, terminate: true };
          throw new Error(message);
        },
      };
      let errorCode: NonNullable<PlaythroughView['opening']>['error'] = null;
      let modelFault: ReturnType<typeof diagnosticFault> | undefined;
      try {
        await deps.llm.run({
          purpose: 'narrator',
          system: CAST_SYSTEM_PROMPT,
          prompt: buildCastPrompt({ meta, projection, codebook, protagonistName }),
          tools: [tool],
          requiredToolName: PROPOSE_CAST_TOOL_NAME,
          sessionId: playthroughId,
          ref: { kind: 'turn_request', id: requestId, attempt, workId },
        });
      } catch (error) {
        if (error instanceof LlmRunError) errorCode = error.code;
        else {
          modelFault = diagnosticFault(error);
          errorCode = storageError(modelFault) ?? 'internal';
        }
      }
      if (errorCode || !holder.value) {
        const code = errorCode ?? 'invalid_output';
        deps.logger.sample({
          metric: 'opening.cast',
          durationMs: performance.now() - castStartedAt,
          outcome: 'error',
          requestId,
          attempt,
          data: { code },
        });
        fail(code, 'cast', modelFault);
        return;
      }
      const members = holder.value;
      deps.db
        .update(playthroughs)
        .set({ cast: members })
        .where(and(eq(playthroughs.id, playthroughId), isNull(playthroughs.cast)))
        .run();
      cast = members;
      deps.logger.sample({
        metric: 'opening.cast',
        durationMs: performance.now() - castStartedAt,
        outcome: 'ok',
        requestId,
        attempt,
        data: { members: members.length },
      });
    }
    const castMembers = cast ?? [];

    const stateDefaults = new Map(
      (opening.initialState ?? []).map((entry) => [
        entry.stateDefId,
        {
          value: entry.value === null ? null : substitutePlaceholders(entry.value, protagonistValues),
          visible: entry.visible,
        },
      ]),
    );
    const ctx: OpeningProposalContext = {
      projection,
      codebook,
      hintMode: settings.actions.hints,
      fixedProse: null,
      fieldNames: [],
      forbiddenNames: [],
      placeholderPolicy: 'reject',
      slots: castMembers.map((member, index) => ({
        index: String(index + 1),
        slotId: member.slotId,
        name: member.name,
      })),
      stateDefaults,
    };
    const proposalHolder: { value: OpeningProposal | null } = { value: null };
    let corrections = 0;
    const tool: LlmTool = {
      name: PROPOSE_OPENING_TOOL_NAME,
      description: PROPOSE_OPENING_DESCRIPTION,
      parameters: PROPOSE_OPENING_PARAMETERS,
      async execute(args) {
        const started = performance.now();
        const parsed = parseOpeningProposal(args, ctx);
        deps.logger.sample({
          metric: 'opening.validate',
          durationMs: performance.now() - started,
          outcome: parsed.ok ? 'ok' : 'error',
          requestId,
          attempt,
          data: parsed.ok ? undefined : { errorCount: parsed.errors.length, fields: parsed.fields },
        });
        log.push({ tool: PROPOSE_OPENING_TOOL_NAME, ok: parsed.ok, errors: parsed.ok ? [] : parsed.errors });
        if (parsed.ok) {
          proposalHolder.value = parsed.value;
          return { text: '已收到。', terminate: true };
        }
        corrections += 1;
        const message = parsed.errors.join('\n');
        if (corrections > MAX_CORRECTIONS) return { text: message, terminate: true };
        throw new Error(message);
      },
    };
    let errorCode: NonNullable<PlaythroughView['opening']>['error'] = null;
    let modelFault: ReturnType<typeof diagnosticFault> | undefined;
    try {
      await deps.llm.run({
        purpose: 'narrator',
        system: OPENING_SYSTEM_PROMPT,
        prompt: buildOpeningPrompt({
          meta,
          settings,
          projection,
          codebook,
          protagonistName,
          opening: {
            prose: substitutePlaceholders(opening.prose, protagonistValues),
            options: opening.options.map((option) => ({
              text: substitutePlaceholders(option.text, protagonistValues),
            })),
          },
          cast: castMembers.map((member, index) => ({
            index: String(index + 1),
            role: roleById.get(member.slotId) ?? '',
            member,
          })),
        }),
        tools: [tool],
        requiredToolName: PROPOSE_OPENING_TOOL_NAME,
        sessionId: playthroughId,
        ref: { kind: 'turn_request', id: requestId, attempt, workId },
      });
    } catch (error) {
      if (error instanceof LlmRunError) {
        errorCode = error.code;
      } else {
        modelFault = diagnosticFault(error);
        errorCode = storageError(modelFault) ?? 'internal';
      }
    }
    if (!errorCode && !proposalHolder.value) errorCode = 'invalid_output';
    if (errorCode) {
      fail(errorCode, errorCode === 'invalid_output' && corrections > 0 ? 'validation' : 'opening', modelFault);
      return;
    }
    const proposal = proposalHolder.value;
    if (!proposal) return;

    const commitStartedAt = performance.now();
    const now = Date.now();
    let committed: { superseded: boolean; routeId: string | null; turnId: string | null };
    try {
      committed = deps.db.transaction(
        (tx) => {
          const current = tx.select().from(playthroughs).where(eq(playthroughs.id, playthroughId)).get();
          if (!current || current.rootTurnId) {
            tx.update(turnRequests)
              .set({ status: 'superseded', log, updatedAt: now })
              .where(and(eq(turnRequests.id, requestId), eq(turnRequests.status, 'running')))
              .run();
            return { superseded: true, routeId: null, turnId: null };
          }
          const committedProposal = proposal;
          const createdIds = allocateEntityIds(committedProposal.changes);
          const turnId = randomUUID();
          tx.insert(turns)
            .values({
              id: turnId,
              playthroughId,
              depth: 0,
              prose: committedProposal.prose,
              options: committedProposal.options,
              scene: proposalScene(
                committedProposal,
                new Map([...projection.entities.values()].map((entity) => [entity.id, { name: entity.name }])),
                createdIds,
              ),
              status: 'committed',
              createdAt: now,
            })
            .run();
          writeChanges(tx, {
            changes: committedProposal.changes,
            createdIds,
            turnId,
            versionId: playthrough.versionId,
            entityVersionIds: [playthrough.versionId],
            entityOrigin: 'turn',
            protagonistId: projection.protagonistId,
            parentPresentIds: [],
            castSlots: committedProposal.slotOf,
          });
          if (nameField) {
            writeProtagonistName(tx, {
              versionId: playthrough.versionId,
              turnId,
              entityId: projection.protagonistId,
              name: protagonistValues[nameField.name]!,
            });
          }
          writeStateValues(tx, {
            versionId: playthrough.versionId,
            turnId,
            values: committedProposal.initialState.map((entry) => ({ ...entry, closed: false })),
          });
          indexTurnProse(tx, turnId, committedProposal.prose);
          const routeId = randomUUID();
          tx.insert(routes)
            .values({ id: routeId, playthroughId, headTurnId: turnId, createdAt: now, updatedAt: now })
            .run();
          tx.update(playthroughs)
            .set({ rootTurnId: turnId, cast: null })
            .where(eq(playthroughs.id, playthroughId))
            .run();
          const updated = tx
            .update(turnRequests)
            .set({ status: 'done', resultTurnId: turnId, log, updatedAt: now })
            .where(and(eq(turnRequests.id, requestId), eq(turnRequests.status, 'running')))
            .run();
          if (updated.changes !== 1) throw new Error('request is no longer running');
          return { superseded: false, routeId, turnId };
        },
        { behavior: 'immediate' },
      );
    } catch (error) {
      const fault = diagnosticFault(error);
      const code = storageError(fault) ?? 'save';
      deps.logger.sample({
        metric: 'opening.commit',
        durationMs: performance.now() - commitStartedAt,
        outcome: 'error',
        requestId,
        attempt,
        data: { code },
      });
      deps.logger.record({
        level: 'error',
        module: 'play',
        event: 'opening.request.failed',
        requestId,
        workId,
        data: { attempt, code, stage: 'commit', ...fault },
      });
      saveFailure(requestId, playthroughId, attempt, code, log);
      deps.logger.sample({
        metric: 'opening.total',
        durationMs: performance.now() - startedAt,
        outcome: 'error',
        requestId,
        attempt,
        data: { code },
      });
      return;
    }

    if (committed.superseded) {
      publishFinished(playthroughId, requestId, 'superseded');
      deps.logger.sample({
        metric: 'opening.commit',
        durationMs: performance.now() - commitStartedAt,
        outcome: 'interrupted',
        requestId,
        attempt,
      });
      deps.logger.sample({
        metric: 'opening.total',
        durationMs: performance.now() - startedAt,
        outcome: 'interrupted',
        requestId,
        attempt,
      });
      return;
    }

    deps.logger.sample({
      metric: 'opening.commit',
      durationMs: performance.now() - commitStartedAt,
      outcome: 'ok',
      requestId,
      attempt,
    });
    publishFinished(playthroughId, requestId, 'done');
    deps.bus.publish({ type: 'turn.committed', routeId: committed.routeId!, turnId: committed.turnId! });
    deps.logger.record({
      level: 'info',
      module: 'play',
      event: 'opening.request.done',
      requestId,
      workId,
      data: { attempt, turnId: committed.turnId },
    });
    deps.logger.sample({
      metric: 'opening.total',
      durationMs: performance.now() - startedAt,
      outcome: 'ok',
      requestId,
      attempt,
    });
  };

  const failBackground = (requestId: string, startedAt: number, error: unknown) => {
    const request = deps.db.select().from(turnRequests).where(eq(turnRequests.id, requestId)).get();
    const fault = diagnosticFault(error);
    const code = storageError(fault) ?? 'internal';
    deps.logger.record({
      level: 'error',
      module: 'play',
      event: 'opening.request.failed',
      requestId,
      data: { code, stage: 'background', ...fault },
    });
    deps.logger.sample({
      metric: 'opening.total',
      durationMs: performance.now() - startedAt,
      outcome: 'error',
      requestId,
      attempt: request?.attempts,
      data: { code },
    });
    if (request) saveFailure(requestId, request.playthroughId, request.attempts, code);
  };

  const enqueue = (requestId: string) => {
    const startedAt = performance.now();
    void queue.add(() =>
      run(requestId, startedAt).catch((error: unknown) => failBackground(requestId, startedAt, error)),
    );
  };

  return {
    enqueue,
    retry(input: RetryOpeningInput): PlaythroughView {
      const result = deps.db.transaction(
        (tx) => {
          const request = tx.select().from(turnRequests).where(eq(turnRequests.id, input.requestId)).get();
          if (!request || request.kind !== 'opening') throw appError('not_found', 'opening request not found');
          if (request.status === 'running') {
            return { retried: false, playthroughId: request.playthroughId };
          }
          if (request.status !== 'failed') throw appError('request_not_retryable', 'request is not failed');
          tx.update(turnRequests)
            .set({ status: 'running', attempts: request.attempts + 1, error: null, updatedAt: Date.now() })
            .where(eq(turnRequests.id, request.id))
            .run();
          return { retried: true, playthroughId: request.playthroughId };
        },
        { behavior: 'immediate' },
      );
      if (result.retried) {
        deps.bus.publish({
          type: 'playthrough.updated',
          playthroughId: result.playthroughId,
          requestId: input.requestId,
          status: 'running',
        });
        enqueue(input.requestId);
      }
      return playthroughView(deps.db, result.playthroughId);
    },
    whenIdle() {
      return queue.onIdle();
    },
  };
}
