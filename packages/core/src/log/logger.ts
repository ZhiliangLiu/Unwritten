import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { scrubSecrets } from './scrub.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type SampleSource = 'core' | 'client' | 'desktop';
export type SampleOutcome = 'ok' | 'error' | 'interrupted';

export interface LogEvent {
  level: LogLevel;
  module: string;
  event: string;
  workId?: string;
  requestId?: string;
  jobId?: string;
  callId?: string;
  data?: Record<string, unknown>;
}

export interface PerformanceSample {
  source?: SampleSource;
  metric: string;
  durationMs: number;
  outcome: SampleOutcome;
  workId?: string;
  requestId?: string;
  jobId?: string;
  callId?: string;
  attempt?: number;
  data?: Record<string, unknown>;
}

export interface Logger {
  record(event: LogEvent): void;
  sample(sample: PerformanceSample): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface LoggerOptions {
  dataDir: string;
  level: LogLevel;
  appVersion: string;
  clock?: () => number;
  schedule?: (callback: () => void) => void;
}

const LEVEL_VALUE: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const QUEUE_LIMIT = 1_024;
const BATCH_LIMIT = 128;
const RETENTION_DAYS = 14;
const DAY_MS = 86_400_000;
const BLOCKED_DATA_KEYS =
  /^(api_?key|key|token|authorization|secret|password|url|stack|message|content|prose|background|input|output|detail)$/i;

type PendingRow =
  | {
      kind: 'event';
      id: string;
      createdAt: number;
      runId: string;
      level: LogLevel;
      module: string;
      event: string;
      workId: string | null;
      requestId: string | null;
      jobId: string | null;
      callId: string | null;
      data: string;
    }
  | {
      kind: 'sample';
      id: string;
      createdAt: number;
      runId: string;
      appVersion: string;
      source: SampleSource;
      metric: string;
      durationMs: number;
      outcome: SampleOutcome;
      workId: string | null;
      requestId: string | null;
      jobId: string | null;
      callId: string | null;
      attempt: number | null;
      data: string;
    };

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return null;
  if (typeof value === 'string') return scrubSecrets(value, []);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (BLOCKED_DATA_KEYS.test(key)) continue;
      result[key] = sanitize(child, depth + 1);
    }
    return result;
  }
  return null;
}

function encodeData(data: Record<string, unknown> | undefined): string {
  return JSON.stringify(sanitize(data ?? {}));
}

function migrationsFolder(): string {
  return fileURLToPath(
    new URL(import.meta.url.endsWith('.ts') ? './migrations/' : './diagnostic-migrations/', import.meta.url),
  );
}

export function createLogger(options: LoggerOptions): Logger {
  const clock = options.clock ?? Date.now;
  const schedule = options.schedule ?? ((callback) => setImmediate(callback));
  const runId = randomUUID();
  const queue: PendingRow[] = [];
  let client: DatabaseSync | null = null;
  let insertEvent: StatementSync | null = null;
  let insertSample: StatementSync | null = null;
  let dropped = 0;
  let reportedFailure = false;
  let lastCleanupDay = '';
  let flushing: Promise<void> | null = null;
  const minimumLevel = LEVEL_VALUE[options.level];

  const reportFailure = () => {
    if (reportedFailure) return;
    reportedFailure = true;
    process.stderr.write('unwritten: diagnostics unavailable\n');
  };

  const closeClient = () => {
    try {
      client?.close();
    } catch {
      void 0;
    }
    client = null;
    insertEvent = null;
    insertSample = null;
  };

  const ensureOpen = (): boolean => {
    if (client) return true;
    try {
      mkdirSync(options.dataDir, { recursive: true });
      const opened = new DatabaseSync(join(options.dataDir, 'diagnostics.db'));
      opened.exec('PRAGMA busy_timeout = 0');
      opened.exec('PRAGMA journal_mode = WAL');
      const db = drizzle({ client: opened });
      migrate(db, { migrationsFolder: migrationsFolder() });
      client = opened;
      insertEvent = opened.prepare(
        `insert into diagnostic_events
          (id, created_at, run_id, level, module, event, work_id, request_id, job_id, call_id, data)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertSample = opened.prepare(
        `insert into performance_samples
          (id, created_at, run_id, app_version, source, metric, duration_ms, outcome,
           work_id, request_id, job_id, call_id, attempt, data)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      reportedFailure = false;
      cleanup(clock());
      return true;
    } catch {
      closeClient();
      reportFailure();
      return false;
    }
  };

  const cleanup = (now: number) => {
    if (!client) return;
    const day = new Date(now).toISOString().slice(0, 10);
    if (day === lastCleanupDay) return;
    lastCleanupDay = day;
    const cutoff = now - RETENTION_DAYS * DAY_MS;
    try {
      client.prepare('delete from diagnostic_events where created_at < ?').run(cutoff);
      client.prepare('delete from performance_samples where created_at < ?').run(cutoff);
    } catch {
      reportFailure();
    }
  };

  const writeBatch = (batch: PendingRow[], now: number) => {
    if (!client || !insertEvent || !insertSample) throw new Error('diagnostics unavailable');
    client.exec('BEGIN');
    try {
      for (const row of batch) {
        if (row.kind === 'event') {
          insertEvent.run(
            row.id,
            row.createdAt,
            row.runId,
            row.level,
            row.module,
            row.event,
            row.workId,
            row.requestId,
            row.jobId,
            row.callId,
            row.data,
          );
        } else {
          insertSample.run(
            row.id,
            row.createdAt,
            row.runId,
            row.appVersion,
            row.source,
            row.metric,
            row.durationMs,
            row.outcome,
            row.workId,
            row.requestId,
            row.jobId,
            row.callId,
            row.attempt,
            row.data,
          );
        }
      }
      client.exec('COMMIT');
      cleanup(now);
    } catch (error) {
      try {
        client.exec('ROLLBACK');
      } catch {
        void 0;
      }
      throw error;
    }
  };

  const doFlush = async (): Promise<void> => {
    while (queue.length || dropped > 0) {
      if (!ensureOpen()) {
        dropped += queue.length;
        queue.length = 0;
        return;
      }
      const batch = queue.splice(0, BATCH_LIMIT);
      const includeDropped = dropped > 0 && batch.length < BATCH_LIMIT;
      if (includeDropped) {
        batch.push({
          kind: 'event',
          id: randomUUID(),
          createdAt: clock(),
          runId,
          level: 'warn',
          module: 'core',
          event: 'diagnostics.dropped',
          workId: null,
          requestId: null,
          jobId: null,
          callId: null,
          data: JSON.stringify({ count: dropped }),
        });
      }
      try {
        writeBatch(batch, clock());
        if (includeDropped) dropped = 0;
      } catch {
        dropped += batch.length;
        closeClient();
        reportFailure();
        return;
      }
      await new Promise<void>((resolve) => schedule(resolve));
    }
  };

  const startFlush = (): Promise<void> => {
    if (!flushing) {
      flushing = doFlush().finally(() => {
        flushing = null;
      });
    }
    return flushing;
  };

  ensureOpen();

  return {
    record(event) {
      if (LEVEL_VALUE[event.level] < minimumLevel) return;
      if (queue.length >= QUEUE_LIMIT) {
        dropped += 1;
        return;
      }
      queue.push({
        kind: 'event',
        id: randomUUID(),
        createdAt: clock(),
        runId,
        level: event.level,
        module: event.module,
        event: event.event,
        workId: event.workId ?? null,
        requestId: event.requestId ?? null,
        jobId: event.jobId ?? null,
        callId: event.callId ?? null,
        data: encodeData(event.data),
      });
    },
    sample(sample) {
      if (queue.length >= QUEUE_LIMIT) {
        dropped += 1;
        return;
      }
      queue.push({
        kind: 'sample',
        id: randomUUID(),
        createdAt: clock(),
        runId,
        appVersion: options.appVersion,
        source: sample.source ?? 'core',
        metric: sample.metric,
        durationMs: sample.durationMs,
        outcome: sample.outcome,
        workId: sample.workId ?? null,
        requestId: sample.requestId ?? null,
        jobId: sample.jobId ?? null,
        callId: sample.callId ?? null,
        attempt: sample.attempt ?? null,
        data: encodeData(sample.data),
      });
    },
    flush() {
      return startFlush();
    },
    async close() {
      await startFlush();
      closeClient();
    },
  };
}
