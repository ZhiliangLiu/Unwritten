import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import {
  ENTITY_KINDS,
  ILLUSTRATION_STAGES,
  ILLUSTRATION_STATUSES,
  IMAGE_PROTOCOLS,
  IMAGE_QUALITIES,
  KNOWLEDGE_LEVELS,
  PORTRAIT_SCOPES,
  PORTRAIT_STATES,
  STATE_DISPLAYS,
  type Appearance,
  type IllustrationFormat,
  type IllustrationStyle,
  type LlmHttpExchange,
  type LlmLogContent,
  type OutputPreferences,
  type StateConfig,
} from '@unwritten/contracts';
import type {
  JobInput,
  JobResult,
  StoredAction,
  StoredOption,
  StoredScene,
  TurnRequestLog,
  VersionMeta,
} from './meta.ts';
import type {
  AttemptData,
  IllustrationSettings,
  ImageFileRef,
  PlaythroughIllustration,
  PortraitSlotsStored,
  PortraitTasks,
  ReferenceFile,
  ShotCapability,
  ShotRef,
} from './illustration-types.ts';
import { FACT_KINDS, type EntityProfile, type FactData } from '../story/types.ts';

export const works = sqliteTable('works', {
  id: text('id').primaryKey(),
  title: text('title'),
  blurb: text('blurb'),
  illustrationStyle: text('illustration_style', { mode: 'json' }).$type<IllustrationStyle>(),
  draftId: text('draft_id').notNull(),
  publishedId: text('published_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const workVersions = sqliteTable(
  'work_versions',
  {
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['draft', 'trial', 'published'] }).notNull(),
    copiedFrom: text('copied_from'),
    contentRev: integer('content_rev').notNull().default(0),
    sourceRev: integer('source_rev'),
    meta: text('meta', { mode: 'json' }).$type<VersionMeta>().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('work_versions_work_idx').on(table.workId)],
);

export const playthroughs = sqliteTable(
  'playthroughs',
  {
    id: text('id').primaryKey(),
    versionId: text('version_id')
      .notNull()
      .references(() => workVersions.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['play', 'trial'] }).notNull(),
    protagonist: text('protagonist', { mode: 'json' }),
    cast: text('cast', { mode: 'json' }),
    illustration: text('illustration', { mode: 'json' })
      .$type<PlaythroughIllustration>()
      .notNull()
      .default(
        sql`'{"enabled":false,"style":{"kind":"preset","preset":"painterly"},"aspectPreference":"auto","resolutionTier":"1k","protagonistInFrame":false,"protagonistAppearance":null,"authorPortraitSetIds":{},"protagonistPortraitSetId":null}'`,
      ),
    rootTurnId: text('root_turn_id'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('playthroughs_version_idx').on(table.versionId)],
);

export const turns = sqliteTable(
  'turns',
  {
    id: text('id').primaryKey(),
    playthroughId: text('playthrough_id')
      .notNull()
      .references(() => playthroughs.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => turns.id),
    depth: integer('depth').notNull(),
    action: text('action', { mode: 'json' }).$type<StoredAction>(),
    prose: text('prose').notNull(),
    options: text('options', { mode: 'json' }).$type<StoredOption[]>().notNull(),
    scene: text('scene', { mode: 'json' }).$type<StoredScene>().notNull(),
    ending: integer('ending').notNull().default(0),
    illustratePara: integer('illustrate_para'),
    status: text('status', { enum: ['committed', 'candidate'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('turns_playthrough_idx').on(table.playthroughId), index('turns_parent_idx').on(table.parentId)],
);

export const routes = sqliteTable(
  'routes',
  {
    id: text('id').primaryKey(),
    playthroughId: text('playthrough_id')
      .notNull()
      .references(() => playthroughs.id, { onDelete: 'cascade' }),
    headTurnId: text('head_turn_id')
      .notNull()
      .references(() => turns.id),
    name: text('name'),
    draftInput: text('draft_input'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('routes_playthrough_idx').on(table.playthroughId)],
);

export const turnRequests = sqliteTable(
  'turn_requests',
  {
    id: text('id').primaryKey(),
    playthroughId: text('playthrough_id')
      .notNull()
      .references(() => playthroughs.id, { onDelete: 'cascade' }),
    routeId: text('route_id').references(() => routes.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['continue', 'rewrite', 'opening'] }).notNull(),
    expectedHeadTurnId: text('expected_head_turn_id'),
    parentTurnId: text('parent_turn_id'),
    action: text('action', { mode: 'json' }).$type<StoredAction>(),
    preference: text('preference'),
    clarification: text('clarification', { mode: 'json' }),
    status: text('status', {
      enum: ['running', 'needs_clarification', 'done', 'failed', 'superseded', 'cancelled'],
    }).notNull(),
    error: text('error'),
    resultTurnId: text('result_turn_id'),
    attempts: integer('attempts').notNull().default(1),
    log: text('log', { mode: 'json' }).$type<TurnRequestLog>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('turn_requests_one_active_per_route')
      .on(table.routeId)
      .where(sql`status in ('running', 'needs_clarification') and route_id is not null`),
    uniqueIndex('turn_requests_one_active_opening')
      .on(table.playthroughId)
      .where(sql`kind = 'opening' and status in ('running', 'needs_clarification')`),
    index('turn_requests_route_idx').on(table.routeId, table.createdAt),
    uniqueIndex('turn_requests_result_idx').on(table.resultTurnId),
  ],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['plan', 'opening', 'title_blurb', 'trial_extract', 'preview'] }).notNull(),
    status: text('status', { enum: ['running', 'done', 'failed'] }).notNull(),
    input: text('input', { mode: 'json' }).$type<JobInput>().notNull(),
    result: text('result', { mode: 'json' }).$type<JobResult>(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('jobs_work_idx').on(table.workId, table.createdAt)],
);

export const llmCalls = sqliteTable(
  'llm_calls',
  {
    id: text('id').primaryKey(),
    purpose: text('purpose').notNull(),
    workId: text('work_id').references(() => works.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    refKind: text('ref_kind'),
    refId: text('ref_id'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cost: real('cost'),
    costFromProvider: integer('cost_from_provider'),
    durationMs: integer('duration_ms'),
    status: text('status', { enum: ['ok', 'error', 'aborted'] }).notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('llm_calls_created_idx').on(table.createdAt)],
);

export const llmCallLogs = sqliteTable(
  'llm_call_logs',
  {
    callId: text('call_id')
      .primaryKey()
      .references(() => llmCalls.id, { onDelete: 'cascade' }),
    workId: text('work_id').references(() => works.id, { onDelete: 'cascade' }),
    system: text('system').notNull(),
    prompt: text('prompt').notNull(),
    response: text('response', { mode: 'json' }).$type<LlmLogContent[]>(),
    http: text('http', { mode: 'json' }).$type<LlmHttpExchange[]>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('llm_call_logs_created_idx').on(table.createdAt)],
);

export const entities = sqliteTable(
  'entities',
  {
    versionId: text('version_id')
      .notNull()
      .references(() => workVersions.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    kind: text('kind', { enum: ENTITY_KINDS }).notNull(),
    name: text('name').notNull(),
    profile: text('profile', { mode: 'json' }).$type<EntityProfile>().notNull(),
    isProtagonist: integer('is_protagonist').notNull().default(0),
    castSlot: text('cast_slot'),
    originTurnId: text('origin_turn_id').references(() => turns.id, { onDelete: 'cascade' }),
    sourcePara: integer('source_para'),
    rev: integer('rev').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.id] }),
    index('entities_origin_idx').on(table.versionId, table.originTurnId),
  ],
);

export const entityNames = sqliteTable(
  'entity_names',
  {
    versionId: text('version_id')
      .notNull()
      .references(() => workVersions.id, { onDelete: 'cascade' }),
    entityId: text('entity_id').notNull(),
    name: text('name').notNull(),
    holderId: text('holder_id'),
    originTurnId: text('origin_turn_id').references(() => turns.id, { onDelete: 'cascade' }),
    sourcePara: integer('source_para'),
  },
  (table) => [index('entity_names_entity_idx').on(table.versionId, table.entityId)],
);

export const facts = sqliteTable(
  'facts',
  {
    versionId: text('version_id')
      .notNull()
      .references(() => workVersions.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    originTurnId: text('origin_turn_id').references(() => turns.id, { onDelete: 'cascade' }),
    sourcePara: integer('source_para'),
    kind: text('kind', { enum: FACT_KINDS }).notNull(),
    subjectId: text('subject_id'),
    objectId: text('object_id'),
    key: text('key'),
    statement: text('statement').notNull(),
    data: text('data', { mode: 'json' }).$type<FactData>(),
    rev: integer('rev').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.id] }),
    index('facts_origin_idx').on(table.versionId, table.originTurnId),
  ],
);

export const knowledge = sqliteTable(
  'knowledge',
  {
    versionId: text('version_id')
      .notNull()
      .references(() => workVersions.id, { onDelete: 'cascade' }),
    factId: text('fact_id').notNull(),
    holderId: text('holder_id').notNull(),
    level: text('level', { enum: KNOWLEDGE_LEVELS }).notNull(),
    perceivedStatement: text('perceived_statement'),
    viaId: text('via_id'),
    originTurnId: text('origin_turn_id').references(() => turns.id, { onDelete: 'cascade' }),
    sourcePara: integer('source_para'),
  },
  (table) => [index('knowledge_fact_idx').on(table.versionId, table.factId)],
);

export const stateDefs = sqliteTable(
  'state_defs',
  {
    versionId: text('version_id')
      .notNull()
      .references(() => workVersions.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    display: text('display', { enum: STATE_DISPLAYS }).notNull(),
    config: text('config', { mode: 'json' }).$type<StateConfig>().notNull(),
    hidden: integer('hidden').notNull().default(0),
    reveal: text('reveal'),
    originTurnId: text('origin_turn_id').references(() => turns.id, { onDelete: 'cascade' }),
    rev: integer('rev').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.id] }),
    index('state_defs_origin_idx').on(table.versionId, table.originTurnId),
  ],
);

export const stateValues = sqliteTable(
  'state_values',
  {
    versionId: text('version_id')
      .notNull()
      .references(() => workVersions.id, { onDelete: 'cascade' }),
    turnId: text('turn_id')
      .notNull()
      .references(() => turns.id, { onDelete: 'cascade' }),
    stateDefId: text('state_def_id').notNull(),
    value: text('value'),
    visible: integer('visible').notNull(),
    closed: integer('closed').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.turnId, table.stateDefId] }),
    foreignKey({
      columns: [table.versionId, table.stateDefId],
      foreignColumns: [stateDefs.versionId, stateDefs.id],
    }).onDelete('cascade'),
  ],
);

export const turnSummaries = sqliteTable('turn_summaries', {
  turnId: text('turn_id')
    .primaryKey()
    .references(() => turns.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const appSettings = sqliteTable(
  'app_settings',
  {
    id: integer('id').primaryKey(),
    appearance: text('appearance', { mode: 'json' }).$type<Appearance>().notNull(),
    illustration: text('illustration', { mode: 'json' })
      .$type<IllustrationSettings>()
      .notNull()
      .default(
        sql`'{"autoEnabled":false,"confirmed":null,"defaults":{"aspectPreference":"auto","resolutionTier":"1k"}}'`,
      ),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [check('app_settings_single_row', sql`${table.id} = 1`)],
);

export const illustrations = sqliteTable(
  'illustrations',
  {
    id: text('id').primaryKey(),
    turnId: text('turn_id')
      .notNull()
      .unique()
      .references(() => turns.id, { onDelete: 'cascade' }),
    playthroughId: text('playthrough_id')
      .notNull()
      .references(() => playthroughs.id, { onDelete: 'cascade' }),
    para: integer('para').notNull(),
    formatPreference: text('format_preference', { mode: 'json' }).$type<OutputPreferences>().notNull(),
    format: text('format', { mode: 'json' }).$type<IllustrationFormat>(),
    status: text('status', { enum: ILLUSTRATION_STATUSES }).notNull(),
    stage: text('stage', { enum: ILLUSTRATION_STAGES }),
    caption: text('caption'),
    prompt: text('prompt'),
    negativePrompt: text('negative_prompt'),
    shotCapability: text('shot_capability', { mode: 'json' }).$type<ShotCapability>(),
    refs: text('refs', { mode: 'json' }).$type<ShotRef[]>(),
    referenceFiles: text('reference_files', { mode: 'json' }).$type<ReferenceFile[]>(),
    seed: integer('seed'),
    serviceId: text('service_id'),
    model: text('model'),
    file: text('file', { mode: 'json' }).$type<ImageFileRef>(),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    activeAttemptId: text('active_attempt_id'),
    attemptData: text('attempt_data', { mode: 'json' }).$type<AttemptData>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('illustrations_queue_idx').on(table.status, table.createdAt),
    index('illustrations_playthrough_idx').on(table.playthroughId),
  ],
);

export const portraitSets = sqliteTable(
  'portrait_sets',
  {
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: PORTRAIT_SCOPES }).notNull(),
    playthroughId: text('playthrough_id').references(() => playthroughs.id, { onDelete: 'cascade' }),
    entityId: text('entity_id'),
    appearanceFactId: text('appearance_fact_id'),
    appearanceHash: text('appearance_hash').notNull(),
    appearance: text('appearance').notNull(),
    style: text('style', { mode: 'json' }).$type<IllustrationStyle>().notNull(),
    state: text('state', { enum: PORTRAIT_STATES }).notNull(),
    draftRev: integer('draft_rev').notNull().default(0),
    slots: text('slots', { mode: 'json' }).$type<PortraitSlotsStored>().notNull(),
    task: text('task', { mode: 'json' }).$type<PortraitTasks>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check('portrait_sets_state', sql`${table.state} in ('draft', 'active', 'retired')`),
    check(
      'portrait_sets_scope',
      sql`(${table.scope} = 'work' and ${table.playthroughId} is null and ${table.entityId} is not null and ${table.appearanceFactId} is null)
        or (${table.scope} = 'pending' and ${table.playthroughId} is null and ${table.appearanceFactId} is null and ${table.state} in ('draft', 'active'))
        or (${table.scope} = 'playthrough' and ${table.playthroughId} is not null and ${table.entityId} is not null and ${table.state} in ('draft', 'active'))`,
    ),
    uniqueIndex('portrait_sets_active_work')
      .on(table.workId, table.entityId, table.appearanceHash)
      .where(sql`${table.scope} = 'work' and ${table.state} = 'active'`),
    uniqueIndex('portrait_sets_playthrough_identity')
      .on(table.playthroughId, table.entityId, sql`ifnull(${table.appearanceFactId}, '')`)
      .where(sql`${table.scope} = 'playthrough'`),
    index('portrait_sets_work_idx').on(table.workId, table.scope),
  ],
);

export const imageCalls = sqliteTable(
  'image_calls',
  {
    id: text('id').primaryKey(),
    serviceId: text('service_id').notNull(),
    protocol: text('protocol', { enum: IMAGE_PROTOCOLS }).notNull(),
    model: text('model'),
    workId: text('work_id').references(() => works.id, { onDelete: 'set null' }),
    refKind: text('ref_kind', { enum: ['illustration', 'portrait', 'test'] }).notNull(),
    refId: text('ref_id'),
    quality: text('quality', { enum: IMAGE_QUALITIES }).notNull(),
    referenceCount: integer('reference_count').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    durationMs: integer('duration_ms'),
    status: text('status', { enum: ['ok', 'error', 'aborted'] }).notNull(),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('image_calls_created_idx').on(table.createdAt)],
);
