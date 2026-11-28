import { z } from 'zod';
import {
  AppearanceTextSchema,
  EntityKindSchema,
  KnowledgeLevelSchema,
  ListItemStatusSchema,
  StateConfigSchema,
  StateDisplaySchema,
  type EntityKind,
  type KnowledgeLevel,
  type StateConfig,
  type StateDisplay,
} from '@unwritten/contracts';
import type { StoredAction, StoredScene } from '../store/meta.ts';

export const FACT_KINDS = ['event', 'trait', 'relation', 'promise', 'secret', 'scene_hit'] as const;
export const FactKindSchema = z.enum(FACT_KINDS);
export type FactKind = z.infer<typeof FactKindSchema>;

export const RELATION_STAGES = ['heard_of', 'met', 'familiar'] as const;
export const PROMISE_STATUSES = ['agreed', 'kept', 'broken'] as const;

export const PROTAGONIST_FALLBACK_NAME = '主角';

export const STORY_LIMITS = {
  changesLinesMax: 40,
  nameMax: 40,
  profileMax: 300,
  statementMax: 200,
  keyMax: 40,
  relationTypeMax: 40,
  perceivedMax: 200,
  placeMax: 100,
  timeMax: 100,
  presentMax: 20,
  witnessesMax: 20,
  relationStrengthMin: -100,
  relationStrengthMax: 100,
  indexProfileChars: 30,
  sceneProfileChars: 40,
  toolResultMaxChars: 4_000,
  catalogPageSize: 30,
  searchMaxHits: 10,
  searchContextChars: 60,
  recentEventsPerEntity: 10,
  nameMinLengthForLeakCheck: 2,
} as const;

export const EntityProfileSchema = z.object({ text: z.string(), appearance: AppearanceTextSchema.optional() });
export type EntityProfile = z.infer<typeof EntityProfileSchema>;

export const APPEARANCE_TRAIT_KEY = 'appearance';

export const FactDataSchema = z.record(z.string(), z.union([z.string(), z.number()]));
export type FactData = z.infer<typeof FactDataSchema>;

export const EntityRefSchema = z.union([
  z.object({ existing: z.string().min(1) }),
  z.object({ created: z.number().int().positive() }),
]);
export type EntityRef = z.infer<typeof EntityRefSchema>;

export const FactRefSchema = z.union([
  z.object({ existing: z.string().min(1) }),
  z.object({ line: z.number().int().positive() }),
]);
export type FactRef = z.infer<typeof FactRefSchema>;

export const NewEntityChangeSchema = z.object({
  line: z.number().int().positive(),
  kind: EntityKindSchema,
  name: z.string().min(1),
  knownAs: z.string().min(1).nullable(),
  profile: z.string(),
  appearance: z.string().nullable().default(null),
  para: z.number().int().positive(),
  protagonist: z.boolean(),
  slot: z.string().nullable().default(null),
});

export const NameChangeSchema = z.object({
  line: z.number().int().positive(),
  entity: EntityRefSchema,
  name: z.string().min(1),
  holder: EntityRefSchema,
  para: z.number().int().positive(),
});

export const FactChangeSchema = z.object({
  line: z.number().int().positive(),
  kind: FactKindSchema,
  subject: EntityRefSchema.nullable(),
  object: EntityRefSchema.nullable(),
  key: z.string().min(1).nullable(),
  statement: z.string().min(1),
  data: FactDataSchema.nullable(),
  para: z.number().int().positive(),
  witnesses: z.array(EntityRefSchema),
});

export const KnowledgeChangeSchema = z.object({
  line: z.number().int().positive(),
  fact: FactRefSchema,
  holder: EntityRefSchema,
  level: KnowledgeLevelSchema,
  perceived: z.string().min(1).nullable(),
  via: EntityRefSchema.nullable(),
  para: z.number().int().positive(),
});

export const SceneChangeSchema = z.object({
  place: z.string().min(1),
  time: z.string().min(1),
  present: z.array(EntityRefSchema),
});

export const StateDefRefSchema = z.union([
  z.object({ existing: z.string().min(1) }),
  z.object({ created: z.number().int().positive() }),
]);
export type StateDefRef = z.infer<typeof StateDefRefSchema>;

export const StateChangeSchema = z.object({
  line: z.number().int().positive(),
  stateDef: StateDefRefSchema,
  value: z.string().nullable(),
  visible: z.boolean().nullable(),
  closed: z.boolean().nullable(),
});

export const StateItemChangeSchema = z.object({
  line: z.number().int().positive(),
  stateDef: StateDefRefSchema,
  item: z.string().min(1),
  status: ListItemStatusSchema,
});

export const NewStateChangeSchema = z.object({
  line: z.number().int().positive(),
  key: z.string().min(1),
  label: z.string().min(1),
  display: StateDisplaySchema,
  config: StateConfigSchema,
  hidden: z.boolean(),
});

export const SecretChangeSchema = z.object({
  line: z.number().int().positive(),
  subject: EntityRefSchema.nullable(),
  title: z.string().min(1),
  statement: z.string().min(1),
  reveal: z.string(),
  knowers: z.array(EntityRefSchema),
  para: z.number().int().positive(),
});

export const SceneHitChangeSchema = z.object({
  line: z.number().int().positive(),
  sceneId: z.string().min(1),
  para: z.number().int().positive(),
});

export const ValidatedChangesSchema = z.object({
  entities: z.array(NewEntityChangeSchema),
  names: z.array(NameChangeSchema),
  facts: z.array(FactChangeSchema),
  knowledge: z.array(KnowledgeChangeSchema),
  scene: SceneChangeSchema.nullable(),
  states: z.array(StateChangeSchema).default([]),
  stateItems: z.array(StateItemChangeSchema).default([]),
  newStates: z.array(NewStateChangeSchema).default([]),
  secrets: z.array(SecretChangeSchema).default([]),
  sceneHits: z.array(SceneHitChangeSchema).default([]),
  droppedAppearances: z.number().int().nonnegative().default(0),
});
export type ValidatedChanges = z.infer<typeof ValidatedChangesSchema>;
export type NewEntityChange = z.infer<typeof NewEntityChangeSchema>;
export type NameChange = z.infer<typeof NameChangeSchema>;
export type FactChange = z.infer<typeof FactChangeSchema>;
export type KnowledgeChange = z.infer<typeof KnowledgeChangeSchema>;
export type SceneChange = z.infer<typeof SceneChangeSchema>;
export type StateChange = z.infer<typeof StateChangeSchema>;
export type StateItemChange = z.infer<typeof StateItemChangeSchema>;
export type NewStateChange = z.infer<typeof NewStateChangeSchema>;
export type SecretChange = z.infer<typeof SecretChangeSchema>;
export type SceneHitChange = z.infer<typeof SceneHitChangeSchema>;

export const EMPTY_CHANGES: ValidatedChanges = {
  entities: [],
  names: [],
  facts: [],
  knowledge: [],
  scene: null,
  states: [],
  stateItems: [],
  newStates: [],
  secrets: [],
  sceneHits: [],
  droppedAppearances: 0,
};

export interface ProjEntity {
  id: string;
  kind: EntityKind;
  name: string;
  profile: string;
  appearance: string | null;
  sourcePara: number | null;
  isProtagonist: boolean;
  originTurnId: string | null;
  originDepth: number;
}

export interface ProjName {
  entityId: string;
  name: string;
  holderId: string | null;
  depth: number;
  turnId: string | null;
  para: number | null;
  seq: number;
}

export interface ProjFact {
  id: string;
  kind: FactKind;
  subjectId: string | null;
  objectId: string | null;
  key: string | null;
  statement: string;
  data: FactData | null;
  depth: number;
  turnId: string | null;
  para: number | null;
}

export interface ProjKnowledge {
  factId: string;
  holderId: string;
  level: KnowledgeLevel;
  perceived: string | null;
  viaId: string | null;
  depth: number;
  turnId: string | null;
  para: number | null;
}

export interface ChainTurn {
  id: string;
  depth: number;
  action: StoredAction | null;
  paragraphs: string[];
  scene: StoredScene;
}

export interface ProjStateDef {
  id: string;
  key: string;
  label: string;
  display: StateDisplay;
  config: StateConfig;
  hidden: boolean;
  reveal: string | null;
  originTurnId: string | null;
  originDepth: number;
}

export interface ProjStateValue {
  stateDefId: string;
  turnId: string;
  depth: number;
  value: string | null;
  visible: boolean;
  closed: boolean;
}

export interface StoryProjection {
  versionId: string;
  headTurnId: string;
  protagonistId: string;
  chain: ChainTurn[];
  entities: Map<string, ProjEntity>;
  names: ProjName[];
  facts: ProjFact[];
  knowledge: ProjKnowledge[];
  summaries: Map<string, string>;
  stateDefs: Map<string, ProjStateDef>;
  stateValues: ProjStateValue[];
}
