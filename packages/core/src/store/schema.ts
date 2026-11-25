import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type {
  PreviewJobInput,
  PreviewJobResult,
  StoredAction,
  StoredOption,
  StoredScene,
  TurnRequestLog,
  VersionMeta,
} from "./meta.ts";

export const works = sqliteTable("works", {
  id: text("id").primaryKey(),
  title: text("title"),
  blurb: text("blurb"),
  draftId: text("draft_id").notNull(),
  publishedId: text("published_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const workVersions = sqliteTable(
  "work_versions",
  {
    id: text("id").primaryKey(),
    workId: text("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["draft", "trial", "published"] }).notNull(),
    copiedFrom: text("copied_from"),
    contentRev: integer("content_rev").notNull().default(0),
    sourceRev: integer("source_rev"),
    meta: text("meta", { mode: "json" }).$type<VersionMeta>().notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("work_versions_work_idx").on(table.workId)],
);

export const playthroughs = sqliteTable(
  "playthroughs",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => workVersions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["play", "trial"] }).notNull(),
    protagonist: text("protagonist", { mode: "json" }),
    cast: text("cast", { mode: "json" }),
    rootTurnId: text("root_turn_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("playthroughs_version_idx").on(table.versionId)],
);

export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    playthroughId: text("playthrough_id")
      .notNull()
      .references(() => playthroughs.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => turns.id),
    depth: integer("depth").notNull(),
    action: text("action", { mode: "json" }).$type<StoredAction>(),
    prose: text("prose").notNull(),
    options: text("options", { mode: "json" }).$type<StoredOption[]>().notNull(),
    scene: text("scene", { mode: "json" }).$type<StoredScene>().notNull(),
    ending: integer("ending").notNull().default(0),
    status: text("status", { enum: ["committed", "candidate"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("turns_playthrough_idx").on(table.playthroughId), index("turns_parent_idx").on(table.parentId)],
);

export const routes = sqliteTable(
  "routes",
  {
    id: text("id").primaryKey(),
    playthroughId: text("playthrough_id")
      .notNull()
      .references(() => playthroughs.id, { onDelete: "cascade" }),
    headTurnId: text("head_turn_id")
      .notNull()
      .references(() => turns.id),
    name: text("name"),
    draftInput: text("draft_input"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("routes_playthrough_idx").on(table.playthroughId)],
);

export const turnRequests = sqliteTable(
  "turn_requests",
  {
    id: text("id").primaryKey(),
    playthroughId: text("playthrough_id")
      .notNull()
      .references(() => playthroughs.id, { onDelete: "cascade" }),
    routeId: text("route_id").references(() => routes.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["continue", "rewrite", "opening"] }).notNull(),
    expectedHeadTurnId: text("expected_head_turn_id"),
    parentTurnId: text("parent_turn_id"),
    action: text("action", { mode: "json" }).$type<StoredAction>(),
    preference: text("preference"),
    clarification: text("clarification", { mode: "json" }),
    status: text("status", {
      enum: ["running", "needs_clarification", "done", "failed", "superseded", "cancelled"],
    }).notNull(),
    error: text("error"),
    resultTurnId: text("result_turn_id"),
    attempts: integer("attempts").notNull().default(1),
    log: text("log", { mode: "json" }).$type<TurnRequestLog>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("turn_requests_one_active_per_route")
      .on(table.routeId)
      .where(sql`status in ('running', 'needs_clarification') and route_id is not null`),
    uniqueIndex("turn_requests_one_active_opening")
      .on(table.playthroughId)
      .where(sql`kind = 'opening' and status in ('running', 'needs_clarification')`),
    index("turn_requests_route_idx").on(table.routeId, table.createdAt),
    uniqueIndex("turn_requests_result_idx").on(table.resultTurnId),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    workId: text("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["plan", "opening", "title_blurb", "trial_extract", "preview"] }).notNull(),
    status: text("status", { enum: ["running", "done", "failed"] }).notNull(),
    input: text("input", { mode: "json" }).$type<PreviewJobInput>().notNull(),
    result: text("result", { mode: "json" }).$type<PreviewJobResult>(),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("jobs_work_idx").on(table.workId, table.createdAt)],
);

export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: text("id").primaryKey(),
    purpose: text("purpose").notNull(),
    workId: text("work_id").references(() => works.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    refKind: text("ref_kind"),
    refId: text("ref_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cost: real("cost"),
    costFromProvider: integer("cost_from_provider"),
    durationMs: integer("duration_ms"),
    status: text("status", { enum: ["ok", "error", "aborted"] }).notNull(),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("llm_calls_created_idx").on(table.createdAt)],
);
