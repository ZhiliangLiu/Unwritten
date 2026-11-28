import { z } from 'zod';
import { ErrorCodeSchema } from '../errors.ts';
import { ContentRevSchema, TimestampSchema, UuidSchema } from './common.ts';
import { AppearanceTextSchema } from './illustration.ts';
import { EntityKindSchema } from './story.ts';

export const SETTING_SECTION_IDS = [
  'world',
  'protagonist',
  'cast',
  'secrets',
  'opening',
  'actions',
  'scenes',
  'status',
] as const;
export const CAST_MODES = ['fixed', 'per_run'] as const;
export const HINT_MODES = ['actions_only', 'known_consequences'] as const;
export const OPENING_MODES = ['ai', 'situation', 'author_text'] as const;
export const WIZARD_STEPS = ['background', 'plan', 'opening'] as const;
export const PLAN_SOURCES = ['author', 'ai', 'author_confirmed'] as const;
export const PLAN_ITEM_KINDS = ['summary', 'entity', 'secret', 'state', 'scene', 'ending'] as const;
export const PLAN_SUMMARY_KEYS = ['identity', 'tone', 'situation', 'world', 'public_setting'] as const;
export const PLAN_ENTITY_ROLES = ['protagonist', 'cast', 'other'] as const;
export const STATE_DISPLAYS = ['number', 'stage', 'list', 'text'] as const;
export const LIST_ITEM_STATUSES = ['open', 'done', 'failed', 'gone'] as const;

export const SETTING_TEXT_MAX_LENGTH = 10_000;
export const PROTAGONIST_FIELDS_MAX = 8;
export const PROTAGONIST_FIELD_NAME_MAX_LENGTH = 20;
export const PROTAGONIST_VALUE_MAX_LENGTH = 40;
export const PROTAGONIST_FIELD_NAME_PATTERN = /^[^{}.\s]+$/u;
export const PLAN_TEXT_MAX_LENGTH = 1_000;
export const PLAN_NAME_MAX_LENGTH = 40;
export const PLAN_PROFILE_MAX_LENGTH = 300;
export const PLAN_STATEMENT_MAX_LENGTH = 200;
export const STATE_LABEL_MAX_LENGTH = 20;
export const STATE_UNIT_MAX_LENGTH = 10;
export const STATE_STAGES_MAX = 12;
export const STATE_STAGE_NAME_MAX_LENGTH = 20;

export const SettingSectionIdSchema = z.enum(SETTING_SECTION_IDS);
export const CastModeSchema = z.enum(CAST_MODES);
export const HintModeSchema = z.enum(HINT_MODES);
export const OpeningModeSchema = z.enum(OPENING_MODES);
export const WizardStepSchema = z.enum(WIZARD_STEPS);
export const PlanSourceSchema = z.enum(PLAN_SOURCES);
export const PlanItemKindSchema = z.enum(PLAN_ITEM_KINDS);
export const PlanSummaryKeySchema = z.enum(PLAN_SUMMARY_KEYS);
export const PlanEntityRoleSchema = z.enum(PLAN_ENTITY_ROLES);
export const StateDisplaySchema = z.enum(STATE_DISPLAYS);
export const ListItemStatusSchema = z.enum(LIST_ITEM_STATUSES);

export const ProtagonistFieldSchema = z.object({
  name: z.string().trim().min(1).max(PROTAGONIST_FIELD_NAME_MAX_LENGTH).regex(PROTAGONIST_FIELD_NAME_PATTERN),
  defaultValue: z.string().trim().min(1).max(PROTAGONIST_VALUE_MAX_LENGTH),
  isName: z.boolean(),
});

const SettingTextSchema = z.string().max(SETTING_TEXT_MAX_LENGTH);

export const WorkSettingsSchema = z.object({
  world: z.object({ text: SettingTextSchema }),
  protagonist: z
    .object({
      text: SettingTextSchema,
      fields: z.array(ProtagonistFieldSchema).max(PROTAGONIST_FIELDS_MAX),
    })
    .superRefine((value, context) => {
      const names = new Set<string>();
      value.fields.forEach((field, index) => {
        if (names.has(field.name)) {
          context.addIssue({ code: 'custom', message: '填写项的名字不能重复', path: ['fields', index, 'name'] });
        }
        names.add(field.name);
      });
      if (value.fields.filter((field) => field.isName).length > 1) {
        context.addIssue({ code: 'custom', message: '最多一个填写项是主角名', path: ['fields'] });
      }
    }),
  cast: z.object({ text: SettingTextSchema, mode: CastModeSchema }),
  secrets: z.object({ text: SettingTextSchema }),
  opening: z.object({ text: SettingTextSchema, mode: OpeningModeSchema }),
  actions: z.object({ text: SettingTextSchema, hints: HintModeSchema }),
  scenes: z.object({ text: SettingTextSchema }),
  status: z.object({ text: SettingTextSchema }),
});

export const DEFAULT_WORK_SETTINGS: WorkSettings = {
  world: { text: '' },
  protagonist: { text: '', fields: [] },
  cast: { text: '', mode: 'fixed' },
  secrets: { text: '' },
  opening: { text: '', mode: 'ai' },
  actions: { text: '', hints: 'actions_only' },
  scenes: { text: '' },
  status: { text: '' },
};

export const StateConfigSchema = z.object({
  min: z.number().finite().nullable(),
  max: z.number().finite().nullable(),
  unit: z.string().max(STATE_UNIT_MAX_LENGTH).nullable(),
  stages: z.array(z.string().trim().min(1).max(STATE_STAGE_NAME_MAX_LENGTH)).max(STATE_STAGES_MAX),
});

const PlanItemBase = {
  id: z.string().min(1).max(64),
  source: PlanSourceSchema,
};

export const PlanItemSchema = z.discriminatedUnion('kind', [
  z.object({
    ...PlanItemBase,
    kind: z.literal('summary'),
    key: PlanSummaryKeySchema,
    text: z.string().min(1).max(PLAN_TEXT_MAX_LENGTH),
  }),
  z.object({
    ...PlanItemBase,
    kind: z.literal('entity'),
    entityKind: EntityKindSchema,
    role: PlanEntityRoleSchema,
    name: z.string().min(1).max(PLAN_NAME_MAX_LENGTH),
    knownAs: z.string().min(1).max(PLAN_NAME_MAX_LENGTH).nullable(),
    profile: z.string().max(PLAN_PROFILE_MAX_LENGTH),
    appearance: AppearanceTextSchema.nullable().default(null),
    slot: z
      .object({
        role: z.string().min(1).max(100),
        encounter: z.string().min(1).max(1_000),
      })
      .nullable(),
  }),
  z.object({
    ...PlanItemBase,
    kind: z.literal('secret'),
    title: z.string().min(1).max(PLAN_NAME_MAX_LENGTH),
    statement: z.string().min(1).max(PLAN_STATEMENT_MAX_LENGTH),
    subjectId: z.string().min(1).nullable(),
    knowerIds: z.array(z.string().min(1)).max(20),
    reveal: z.string().max(1_000),
  }),
  z.object({
    ...PlanItemBase,
    kind: z.literal('state'),
    key: z.string().min(1).max(40),
    label: z.string().min(1).max(STATE_LABEL_MAX_LENGTH),
    display: StateDisplaySchema,
    config: StateConfigSchema,
    hidden: z.boolean(),
    reveal: z.string().max(1_000),
    initial: z.string().max(200).nullable(),
  }),
  z.object({
    ...PlanItemBase,
    kind: z.literal('scene'),
    condition: z.string().min(1).max(1_000),
    outcome: z.string().min(1).max(1_000),
    once: z.boolean(),
  }),
  z.object({
    ...PlanItemBase,
    kind: z.literal('ending'),
    text: z.string().min(1).max(1_000),
  }),
]);

export const PlanConflictSchema = z.object({
  first: z.string().min(1).max(500),
  second: z.string().min(1).max(500),
  impact: z.string().min(1).max(500),
});

export const JobStatusSchema = z.enum(['running', 'done', 'failed']);

export const PlanViewSchema = z.object({
  items: z.array(PlanItemSchema),
  conflicts: z.array(PlanConflictSchema),
  confirmed: z.boolean(),
});

export const PlanJobViewSchema = z.object({
  id: UuidSchema,
  status: JobStatusSchema,
  basedOnContentRev: ContentRevSchema,
  error: ErrorCodeSchema.nullable(),
  stale: z.boolean(),
  updatedAt: TimestampSchema,
});

export type SettingSectionId = z.infer<typeof SettingSectionIdSchema>;
export type CastMode = z.infer<typeof CastModeSchema>;
export type HintMode = z.infer<typeof HintModeSchema>;
export type OpeningMode = z.infer<typeof OpeningModeSchema>;
export type WizardStep = z.infer<typeof WizardStepSchema>;
export type PlanSource = z.infer<typeof PlanSourceSchema>;
export type PlanItemKind = z.infer<typeof PlanItemKindSchema>;
export type PlanSummaryKey = z.infer<typeof PlanSummaryKeySchema>;
export type PlanEntityRole = z.infer<typeof PlanEntityRoleSchema>;
export type StateDisplay = z.infer<typeof StateDisplaySchema>;
export type ListItemStatus = z.infer<typeof ListItemStatusSchema>;
export type ProtagonistField = z.infer<typeof ProtagonistFieldSchema>;
export type WorkSettings = z.infer<typeof WorkSettingsSchema>;
export type StateConfig = z.infer<typeof StateConfigSchema>;
export type PlanItem = z.infer<typeof PlanItemSchema>;
export type PlanConflict = z.infer<typeof PlanConflictSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type PlanView = z.infer<typeof PlanViewSchema>;
export type PlanJobView = z.infer<typeof PlanJobViewSchema>;
