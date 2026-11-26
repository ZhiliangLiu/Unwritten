import { eq, inArray, sql } from 'drizzle-orm';
import PQueue from 'p-queue';
import type { CoreDeps, LlmService, SummaryService } from '../services.ts';
import { ancestorChain } from '../play/chain.ts';
import { playthroughs, turnSummaries, turns, workVersions } from '../store/schema.ts';
import type { VersionMeta } from '../store/meta.ts';
import { LlmRunError } from '../llm/types.ts';
import { SUMMARY_LIMITS, SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } from './prompt.ts';

export const SUMMARY_CONCURRENCY = 1;
export const SUMMARY_BACKFILL_DAYS = 7;
export const SUMMARY_BACKFILL_MAX = 200;

export function createSummaryService(deps: CoreDeps & { llm: LlmService }): SummaryService {
  const queue = new PQueue({ concurrency: SUMMARY_CONCURRENCY });

  const recordFailure = (turnId: string, code: string, workId: string | null) => {
    deps.logger.record({
      level: 'warn',
      module: 'summary',
      event: 'summary.failed',
      workId: workId ?? undefined,
      data: { turnId, code },
    });
  };

  const run = async (turnId: string, routeId: string): Promise<void> => {
    const startedAt = performance.now();
    const turn = deps.db.select().from(turns).where(eq(turns.id, turnId)).get();
    if (!turn || turn.depth === 0) return;
    const existing = deps.db.select().from(turnSummaries).where(eq(turnSummaries.turnId, turnId)).get();
    if (existing) return;
    const playthrough = deps.db.select().from(playthroughs).where(eq(playthroughs.id, turn.playthroughId)).get();
    if (!playthrough) return;
    const version = deps.db.select().from(workVersions).where(eq(workVersions.id, playthrough.versionId)).get();
    if (!version) return;
    const language = (version.meta as VersionMeta).narration?.language ?? 'zh-CN';
    const workId = version.workId;

    if (!deps.llm.resolve('background')) {
      recordFailure(turnId, 'llm_not_configured', workId);
      deps.logger.sample({
        metric: 'summary.total',
        durationMs: performance.now() - startedAt,
        outcome: 'error',
        workId,
        data: { turnId, code: 'llm_not_configured' },
      });
      return;
    }

    let code: string | null = null;
    let text = '';
    try {
      const result = await deps.llm.complete({
        purpose: 'background',
        system: SUMMARY_SYSTEM_PROMPT,
        prompt: buildSummaryPrompt({
          depth: turn.depth,
          action: turn.action?.text ?? null,
          prose: turn.prose,
          language,
        }),
        sessionId: routeId,
        ref: { kind: 'turn', id: turnId, attempt: 1, workId },
        maxOutputTokens: SUMMARY_LIMITS.maxOutputTokens,
        signal: deps.shutdown,
      });
      text = result.text;
    } catch (error) {
      code = error instanceof LlmRunError ? error.code : 'internal';
    }

    if (code === null) {
      const summary = Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, SUMMARY_LIMITS.maxChars).join('');
      if (!summary) {
        code = 'invalid_output';
      } else {
        deps.db.run(
          sql`insert into turn_summaries (turn_id, summary, created_at)
              select ${turnId}, ${summary}, ${Date.now()}
              where exists (select 1 from turns where id = ${turnId})
              on conflict(turn_id) do nothing`,
        );
        deps.logger.record({
          level: 'info',
          module: 'summary',
          event: 'summary.done',
          workId,
          data: { turnId },
        });
        deps.logger.sample({
          metric: 'summary.total',
          durationMs: performance.now() - startedAt,
          outcome: 'ok',
          workId,
          data: { turnId },
        });
        return;
      }
    }

    recordFailure(turnId, code ?? 'internal', workId);
    deps.logger.sample({
      metric: 'summary.total',
      durationMs: performance.now() - startedAt,
      outcome: 'error',
      workId,
      data: { turnId, code: code ?? 'internal' },
    });
  };

  const enqueue = (turnId: string, routeId: string): void => {
    if (deps.shutdown.aborted) return;
    void queue
      .add(() => run(turnId, routeId))
      .catch(() => {
        recordFailure(turnId, 'internal', null);
      });
  };

  return {
    enqueue,
    backfill(): number {
      const cutoff = Date.now() - SUMMARY_BACKFILL_DAYS * 86_400_000;
      const routeRows = deps.db.all<{ id: string; head_turn_id: string }>(
        sql`select id, head_turn_id from routes where updated_at >= ${cutoff} order by updated_at desc`,
      );
      let scheduled = 0;
      for (const route of routeRows) {
        if (scheduled >= SUMMARY_BACKFILL_MAX) break;
        const chain = ancestorChain(deps.db, route.head_turn_id);
        const candidates = chain.filter((turn) => turn.depth > 0);
        if (candidates.length === 0) continue;
        const summaries = deps.db
          .select({ turnId: turnSummaries.turnId })
          .from(turnSummaries)
          .where(
            inArray(
              turnSummaries.turnId,
              candidates.map((turn) => turn.id),
            ),
          )
          .all();
        const summarized = new Set(summaries.map((row) => row.turnId));
        const missing = candidates
          .filter((turn) => !summarized.has(turn.id))
          .sort((left, right) => right.depth - left.depth);
        for (const turn of missing) {
          if (scheduled >= SUMMARY_BACKFILL_MAX) break;
          enqueue(turn.id, route.id);
          scheduled += 1;
        }
      }
      return scheduled;
    },
    whenIdle() {
      return queue.onIdle();
    },
  };
}
