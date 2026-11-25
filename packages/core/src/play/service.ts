import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import PQueue from "p-queue";
import type {
  RetryInput,
  RouteIdInput,
  RouteView,
  SubmitActionInput,
  TurnRequestView,
  TurnView,
} from "@unwritten/contracts";
import { appError } from "../errors.ts";
import type { CoreDeps, LlmService, PlayService } from "../services.ts";
import { playthroughs, routes, turnRequests, turns, workVersions, works } from "../store/schema.ts";
import type { StoredAction, TurnRequestLog, VersionMeta } from "../store/meta.ts";
import type { LlmTool } from "../llm/types.ts";
import { LlmRunError } from "../llm/types.ts";
import { ancestorChain, type TurnRow } from "./chain.ts";
import { buildNarratorContext } from "./context.ts";
import { PROPOSE_TURN_DESCRIPTION } from "./narrator-prompt.ts";
import { PROPOSE_TURN_PARAMETERS, PROPOSE_TURN_TOOL_NAME, parseProposeTurnArgs } from "./propose-turn-tool.ts";

const TURN_CONCURRENCY = 2;
const MAX_CORRECTIONS = 2;
const REQUEST_LOG_RETENTION_DAYS = 90;

function actionView(action: StoredAction | null) {
  return action ? { text: action.text, optionIndex: action.optionIndex } : { text: "", optionIndex: null };
}

function requestView(row: typeof turnRequests.$inferSelect): TurnRequestView {
  return {
    id: row.id,
    status: row.status,
    action: actionView(row.action),
    error: (row.error as TurnRequestView["error"]) ?? null,
    attempts: row.attempts,
    expectedHeadTurnId: row.expectedHeadTurnId ?? row.parentTurnId ?? "",
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
    prose: turn.prose,
    options: turn.options,
    createdAt: turn.createdAt,
  };
}

export function createPlayService(deps: CoreDeps & { llm: LlmService }): PlayService {
  const queue = new PQueue({ concurrency: TURN_CONCURRENCY });

  const getRoute = (input: RouteIdInput): RouteView => {
    const route = deps.db.select().from(routes).where(eq(routes.id, input.routeId)).get();
    if (!route) throw appError("not_found", "route not found");
    const playthrough = deps.db.select().from(playthroughs).where(eq(playthroughs.id, route.playthroughId)).get();
    if (!playthrough) throw appError("not_found", "playthrough not found");
    const version = deps.db.select().from(workVersions).where(eq(workVersions.id, playthrough.versionId)).get();
    if (!version) throw appError("not_found", "version not found");
    const work = deps.db.select().from(works).where(eq(works.id, version.workId)).get();
    if (!work) throw appError("not_found", "work not found");
    const chain = ancestorChain(deps.db, route.headTurnId);
    const pending = deps.db
      .select()
      .from(turnRequests)
      .where(
        and(
          eq(turnRequests.routeId, route.id),
          eq(turnRequests.expectedHeadTurnId, route.headTurnId),
          inArray(turnRequests.status, ["running", "failed"]),
        ),
      )
      .orderBy(desc(turnRequests.createdAt))
      .get();
    return {
      id: route.id,
      workId: work.id,
      workTitle: work.title,
      language: (version.meta as VersionMeta).narration?.language ?? "zh-CN",
      headTurnId: route.headTurnId,
      turns: chain.map(turnView),
      pending: pending ? requestView(pending) : null,
    };
  };

  const runTurnRequest = async (requestId: string): Promise<void> => {
    const request = deps.db.select().from(turnRequests).where(eq(turnRequests.id, requestId)).get();
    if (!request || request.status !== "running" || !request.routeId) return;
    const route = deps.db.select().from(routes).where(eq(routes.id, request.routeId)).get();
    if (!route) return;
    const playthrough = deps.db.select().from(playthroughs).where(eq(playthroughs.id, route.playthroughId)).get();
    if (!playthrough) return;
    const version = deps.db.select().from(workVersions).where(eq(workVersions.id, playthrough.versionId)).get();
    if (!version) return;
    const meta = version.meta as VersionMeta;
    const parentId = request.parentTurnId ?? route.headTurnId;
    const chain = ancestorChain(deps.db, parentId);
    const model = deps.llm.resolve("narrator");
    if (!model) {
      deps.db
        .update(turnRequests)
        .set({ status: "failed", error: "llm_not_configured", updatedAt: Date.now() })
        .where(and(eq(turnRequests.id, requestId), eq(turnRequests.status, "running")))
        .run();
      deps.bus.publish({ type: "turn_request.updated", routeId: route.id, requestId, status: "failed" });
      return;
    }
    const context = buildNarratorContext({
      meta,
      chain,
      action: request.action ?? { text: "", optionIndex: null },
      model,
      estimateTokens: (text) => deps.llm.estimateTokens(text),
      toolSchemaText: `${JSON.stringify(PROPOSE_TURN_PARAMETERS)}${PROPOSE_TURN_DESCRIPTION}`,
    });
    const log: TurnRequestLog = [];
    if (!context.ok) {
      deps.db
        .update(turnRequests)
        .set({ status: "failed", error: context.code, log, updatedAt: Date.now() })
        .where(and(eq(turnRequests.id, requestId), eq(turnRequests.status, "running")))
        .run();
      deps.bus.publish({ type: "turn_request.updated", routeId: route.id, requestId, status: "failed" });
      return;
    }

    let proposed: ReturnType<typeof parseProposeTurnArgs> | null = null;
    let corrections = 0;
    const parentScene = chain.at(-1)?.scene ?? { place: "", time: "", present: [] };
    const tool: LlmTool = {
      name: PROPOSE_TURN_TOOL_NAME,
      description: PROPOSE_TURN_DESCRIPTION,
      parameters: PROPOSE_TURN_PARAMETERS,
      async execute(args) {
        const parsed = parseProposeTurnArgs(args, parentScene);
        log.push({ tool: PROPOSE_TURN_TOOL_NAME, ok: parsed.ok, errors: parsed.ok ? [] : parsed.errors });
        if (parsed.ok) {
          proposed = parsed;
          return { text: "已收到。", terminate: true };
        }
        corrections += 1;
        const message = parsed.errors.join("\n");
        if (corrections > MAX_CORRECTIONS) return { text: message, terminate: true };
        throw new Error(message);
      },
    };

    let errorCode: TurnRequestView["error"] = null;
    try {
      await deps.llm.run({
        purpose: "narrator",
        system: context.system,
        prompt: context.prompt,
        tools: [tool],
        requiredToolName: PROPOSE_TURN_TOOL_NAME,
        sessionId: route.id,
        ref: { kind: "turn_request", id: requestId, attempt: request.attempts, workId: version.workId },
      });
    } catch (error) {
      errorCode = error instanceof LlmRunError ? error.code : "internal";
    }

    const parsedProposal = proposed as ReturnType<typeof parseProposeTurnArgs> | null;
    if (!errorCode && (!parsedProposal || !parsedProposal.ok)) errorCode = "invalid_output";
    const now = Date.now();
    if (errorCode) {
      deps.db
        .update(turnRequests)
        .set({ status: "failed", error: errorCode, log, updatedAt: now })
        .where(and(eq(turnRequests.id, requestId), eq(turnRequests.status, "running")))
        .run();
      deps.bus.publish({ type: "turn_request.updated", routeId: route.id, requestId, status: "failed" });
      deps.logger.record({
        level: "warn",
        module: "play",
        event: "turn.request.failed",
        requestId,
        data: { attempt: request.attempts, code: errorCode },
      });
      return;
    }

    const proposal = (parsedProposal as Extract<ReturnType<typeof parseProposeTurnArgs>, { ok: true }>).value;
    const committed = deps.db.transaction(
      (tx) => {
        const current = tx.select().from(routes).where(eq(routes.id, route.id)).get();
        if (!current || current.headTurnId !== request.expectedHeadTurnId) {
          tx.update(turnRequests)
            .set({ status: "superseded", log, updatedAt: now })
            .where(and(eq(turnRequests.id, requestId), eq(turnRequests.status, "running")))
            .run();
          return { superseded: true, turnId: null };
        }
        const parent = tx.select().from(turns).where(eq(turns.id, parentId)).get();
        if (!parent) throw new Error("parent turn disappeared");
        const turnId = randomUUID();
        tx.insert(turns)
          .values({
            id: turnId,
            playthroughId: route.playthroughId,
            parentId,
            depth: parent.depth + 1,
            action: request.action,
            prose: proposal.prose,
            options: proposal.options,
            scene: proposal.scene,
            ending: 0,
            status: "committed",
            createdAt: now,
          })
          .run();
        const routeUpdate = tx
          .update(routes)
          .set({ headTurnId: turnId, updatedAt: now, draftInput: null })
          .where(and(eq(routes.id, route.id), eq(routes.headTurnId, request.expectedHeadTurnId ?? "")))
          .run();
        if (routeUpdate.changes !== 1) throw new Error("route head changed");
        const requestUpdate = tx
          .update(turnRequests)
          .set({ status: "done", resultTurnId: turnId, log, updatedAt: now })
          .where(and(eq(turnRequests.id, requestId), eq(turnRequests.status, "running")))
          .run();
        if (requestUpdate.changes !== 1) throw new Error("request is no longer running");
        return { superseded: false, turnId };
      },
      { behavior: "immediate" },
    );

    if (committed.superseded) {
      deps.bus.publish({ type: "turn_request.updated", routeId: route.id, requestId, status: "superseded" });
      deps.logger.record({
        level: "info",
        module: "play",
        event: "turn.request.superseded",
        requestId,
        data: { attempt: request.attempts },
      });
      return;
    }
    deps.bus.publish({ type: "turn.committed", routeId: route.id, turnId: committed.turnId! });
    deps.bus.publish({ type: "turn_request.updated", routeId: route.id, requestId, status: "done" });
    deps.logger.record({
      level: "info",
      module: "play",
      event: "turn.request.done",
      requestId,
      data: { attempt: request.attempts, turnId: committed.turnId },
    });
  };

  return {
    getRoute,
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
            if (!same) throw appError("idempotency_conflict", "request id is already used");
            return { view: requestView(existing), created: false, routeId: input.routeId };
          }
          const route = tx.select().from(routes).where(eq(routes.id, input.routeId)).get();
          if (!route) throw appError("not_found", "route not found");
          if (route.headTurnId !== input.expectedHeadTurnId) throw appError("stale_head", "route head moved");
          if (input.action.optionIndex !== null) {
            const head = tx.select().from(turns).where(eq(turns.id, route.headTurnId)).get();
            const option = head?.options[input.action.optionIndex - 1];
            if (!option || option.text !== input.action.text) throw appError("option_mismatch", "option changed");
          }
          const active = tx
            .select()
            .from(turnRequests)
            .where(
              and(eq(turnRequests.routeId, route.id), inArray(turnRequests.status, ["running", "needs_clarification"])),
            )
            .get();
          if (active) throw appError("request_in_progress", "another request is running");
          if (!deps.llm.resolve("narrator")) throw appError("llm_not_configured", "no narrator model");
          const now = Date.now();
          try {
            tx.insert(turnRequests)
              .values({
                id: input.requestId,
                playthroughId: route.playthroughId,
                routeId: route.id,
                kind: "continue",
                expectedHeadTurnId: route.headTurnId,
                parentTurnId: route.headTurnId,
                action: input.action,
                status: "running",
                attempts: 1,
                createdAt: now,
                updatedAt: now,
              })
              .run();
          } catch {
            throw appError("request_in_progress", "another request is running");
          }
          const row = tx.select().from(turnRequests).where(eq(turnRequests.id, input.requestId)).get();
          return { view: requestView(row!), created: true, routeId: route.id };
        },
        { behavior: "immediate" },
      );
      if (result.created) {
        deps.bus.publish({
          type: "turn_request.updated",
          routeId: result.routeId,
          requestId: input.requestId,
          status: "running",
        });
        deps.logger.record({
          level: "info",
          module: "play",
          event: "turn.request.submitted",
          requestId: input.requestId,
          data: { attempt: 1 },
        });
        void queue.add(() => runTurnRequest(input.requestId));
      }
      return result.view;
    },
    retry(input: RetryInput): TurnRequestView {
      const result = deps.db.transaction(
        (tx) => {
          const request = tx.select().from(turnRequests).where(eq(turnRequests.id, input.requestId)).get();
          if (!request) throw appError("not_found", "request not found");
          if (request.status === "running")
            return { view: requestView(request), action: "none" as const, routeId: request.routeId };
          if (request.status !== "failed") throw appError("request_not_retryable", "request is not failed");
          const route = request.routeId ? tx.select().from(routes).where(eq(routes.id, request.routeId)).get() : null;
          if (!route) throw appError("not_found", "route not found");
          if (route.headTurnId !== request.expectedHeadTurnId) {
            tx.update(turnRequests)
              .set({ status: "superseded", updatedAt: Date.now() })
              .where(eq(turnRequests.id, request.id))
              .run();
            const row = tx.select().from(turnRequests).where(eq(turnRequests.id, request.id)).get();
            return { view: requestView(row!), action: "superseded" as const, routeId: route.id };
          }
          const active = tx
            .select()
            .from(turnRequests)
            .where(and(eq(turnRequests.routeId, route.id), eq(turnRequests.status, "running")))
            .get();
          if (active) throw appError("request_in_progress", "another request is running");
          if (!deps.llm.resolve("narrator")) throw appError("llm_not_configured", "no narrator model");
          tx.update(turnRequests)
            .set({ status: "running", attempts: request.attempts + 1, error: null, updatedAt: Date.now() })
            .where(eq(turnRequests.id, request.id))
            .run();
          const row = tx.select().from(turnRequests).where(eq(turnRequests.id, request.id)).get();
          return { view: requestView(row!), action: "retry" as const, routeId: route.id };
        },
        { behavior: "immediate" },
      );
      if (result.action === "retry") {
        deps.bus.publish({
          type: "turn_request.updated",
          routeId: result.routeId!,
          requestId: input.requestId,
          status: "running",
        });
        deps.logger.record({
          level: "info",
          module: "play",
          event: "turn.request.submitted",
          requestId: input.requestId,
          data: { attempt: result.view.attempts },
        });
        void queue.add(() => runTurnRequest(input.requestId));
      } else if (result.action === "superseded") {
        deps.bus.publish({
          type: "turn_request.updated",
          routeId: result.routeId!,
          requestId: input.requestId,
          status: "superseded",
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
          level: "warn",
          module: "play",
          event: "turn.request.failed",
          requestId: row.id,
          data: { attempt: row.attempts, code: "interrupted" },
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
