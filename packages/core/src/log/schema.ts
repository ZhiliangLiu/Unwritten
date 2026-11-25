import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const diagnosticEvents = sqliteTable(
  'diagnostic_events',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at').notNull(),
    runId: text('run_id').notNull(),
    level: text('level').notNull(),
    module: text('module').notNull(),
    event: text('event').notNull(),
    workId: text('work_id'),
    requestId: text('request_id'),
    jobId: text('job_id'),
    callId: text('call_id'),
    data: text('data', { mode: 'json' }).notNull(),
  },
  (table) => [
    index('diagnostic_events_created_idx').on(table.createdAt),
    index('diagnostic_events_run_idx').on(table.runId, table.createdAt),
    index('diagnostic_events_request_idx').on(table.requestId, table.createdAt),
    index('diagnostic_events_job_idx').on(table.jobId, table.createdAt),
    index('diagnostic_events_call_idx').on(table.callId, table.createdAt),
  ],
);

export const performanceSamples = sqliteTable(
  'performance_samples',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at').notNull(),
    runId: text('run_id').notNull(),
    appVersion: text('app_version').notNull(),
    source: text('source').notNull(),
    metric: text('metric').notNull(),
    durationMs: real('duration_ms').notNull(),
    outcome: text('outcome').notNull(),
    workId: text('work_id'),
    requestId: text('request_id'),
    jobId: text('job_id'),
    callId: text('call_id'),
    attempt: integer('attempt'),
    data: text('data', { mode: 'json' }).notNull(),
  },
  (table) => [
    index('performance_samples_created_idx').on(table.createdAt),
    index('performance_samples_version_idx').on(table.appVersion, table.createdAt),
    index('performance_samples_metric_idx').on(table.metric, table.appVersion, table.createdAt),
    index('performance_samples_request_idx').on(table.requestId, table.createdAt),
    index('performance_samples_job_idx').on(table.jobId, table.createdAt),
    index('performance_samples_call_idx').on(table.callId, table.createdAt),
  ],
);
