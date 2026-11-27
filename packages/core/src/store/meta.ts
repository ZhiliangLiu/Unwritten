import {
  EMPTY_WORK_ANCHORS,
  LanguageTagSchema,
  OptionViewSchema,
  PlanConflictSchema,
  PlanItemSchema,
  PreviewSchema,
  WorkAnchorsSchema,
  WorkSettingsSchema,
  WizardStepSchema,
  type WorkAnchors,
} from '@unwritten/contracts';
import { z } from 'zod';
import { ValidatedChangesSchema } from '../story/types.ts';

export const StoredOptionSchema = z.object({ text: z.string(), hint: z.string().nullable().default(null) });
export const StoredSceneSchema = z.object({
  place: z.string(),
  time: z.string(),
  present: z.array(z.string()),
  presentIds: z.array(z.string()).default([]),
});
export const StoredActionSchema = z.object({ text: z.string(), optionIndex: z.number().int().nullable() });

export const PUBLIC_SETTING_PLAN_ITEM_ID = 'public_setting';

const rev = { rev: z.number().int().nonnegative().default(0) };

export const StoredSettingsSchema = z.object({
  world: WorkSettingsSchema.shape.world.extend(rev),
  protagonist: WorkSettingsSchema.shape.protagonist.extend(rev),
  cast: WorkSettingsSchema.shape.cast.extend(rev),
  secrets: WorkSettingsSchema.shape.secrets.extend(rev),
  opening: WorkSettingsSchema.shape.opening.extend(rev),
  actions: WorkSettingsSchema.shape.actions.extend(rev),
  scenes: WorkSettingsSchema.shape.scenes.extend(rev),
  status: WorkSettingsSchema.shape.status.extend(rev),
});

export const StoredPlanSchema = z.object({
  items: z.array(PlanItemSchema),
  conflicts: z.array(PlanConflictSchema).default([]),
  confirmedRev: z.number().int().nonnegative().nullable().default(null),
});

export const CastSlotSchema = z.object({ id: z.string().min(1), role: z.string(), encounter: z.string() });

export const KeySceneSchema = z.object({
  id: z.string().min(1),
  condition: z.string(),
  outcome: z.string(),
  once: z.boolean(),
});

export const OpeningInitialStateSchema = z.object({
  stateDefId: z.string().min(1),
  value: z.string().nullable(),
  visible: z.boolean(),
});

export const VersionMetaSchema = z.object({
  background: z.string(),
  anchors: WorkAnchorsSchema.optional(),
  settings: StoredSettingsSchema.optional(),
  plan: StoredPlanSchema.optional(),
  castSlots: z.array(CastSlotSchema).optional(),
  keyScenes: z.array(KeySceneSchema).optional(),
  ending: z.string().optional(),
  wizardStep: WizardStepSchema.optional(),
  opening: z
    .object({
      prose: z.string(),
      options: z.array(OptionViewSchema),
      scene: StoredSceneSchema,
      changes: ValidatedChangesSchema.optional(),
      initialState: z.array(OpeningInitialStateSchema).optional(),
      createdIds: z.record(z.string(), z.string()).optional(),
      template: z.boolean().optional(),
    })
    .optional(),
  narration: z.object({ language: z.string() }).optional(),
});

export const PreviewJobInputSchema = z.object({
  contentRev: z.number().int().nonnegative(),
  background: z.string(),
  anchors: WorkAnchorsSchema.optional(),
});
export const PreviewJobResultSchema = z.object({
  preview: PreviewSchema,
  changes: ValidatedChangesSchema.optional(),
  initialState: z.array(OpeningInitialStateSchema).optional(),
  slots: z.record(z.string(), z.string()).optional(),
  adoption: z.object({ versionId: z.string(), routeId: z.string().nullable() }).nullable(),
});

export const PlanJobInputSchema = z.object({
  contentRev: z.number().int().nonnegative(),
  background: z.string(),
  anchors: WorkAnchorsSchema.optional(),
  settings: WorkSettingsSchema,
  protectedItems: z.array(PlanItemSchema),
});
export const PlanJobResultSchema = z.object({
  items: z.array(PlanItemSchema),
  conflicts: z.array(PlanConflictSchema),
  language: LanguageTagSchema,
  stale: z.boolean(),
});

export const TurnRequestLogSchema = z.array(
  z.object({
    tool: z.string(),
    ok: z.boolean(),
    errors: z.array(z.string()),
    args: z.record(z.string(), z.string()).optional(),
    records: z.array(z.string()).optional(),
  }),
);

export type StoredOption = z.infer<typeof StoredOptionSchema>;
export type StoredScene = z.infer<typeof StoredSceneSchema>;
export type StoredAction = z.infer<typeof StoredActionSchema>;
export type StoredSettings = z.infer<typeof StoredSettingsSchema>;
export type StoredPlan = z.infer<typeof StoredPlanSchema>;
export type CastSlot = z.infer<typeof CastSlotSchema>;
export type KeyScene = z.infer<typeof KeySceneSchema>;
export type OpeningInitialState = z.infer<typeof OpeningInitialStateSchema>;
export type VersionMeta = z.infer<typeof VersionMetaSchema>;
export type PreviewJobInput = z.infer<typeof PreviewJobInputSchema>;
export type PreviewJobResult = z.infer<typeof PreviewJobResultSchema>;
export type PlanJobInput = z.infer<typeof PlanJobInputSchema>;
export type PlanJobResult = z.infer<typeof PlanJobResultSchema>;
export type TurnRequestLog = z.infer<typeof TurnRequestLogSchema>;

export type JobInput = PreviewJobInput | PlanJobInput;
export type JobResult = PreviewJobResult | PlanJobResult;

export function previewJobParts(row: { kind: string; input: JobInput; result: JobResult | null }): {
  input: PreviewJobInput;
  result: PreviewJobResult | null;
} {
  if (row.kind !== 'preview') throw new Error('job kind mismatch');
  return { input: row.input as PreviewJobInput, result: row.result as PreviewJobResult | null };
}

export function planJobParts(row: { kind: string; input: JobInput; result: JobResult | null }): {
  input: PlanJobInput;
  result: PlanJobResult | null;
} {
  if (row.kind !== 'plan') throw new Error('job kind mismatch');
  return { input: row.input as PlanJobInput, result: row.result as PlanJobResult | null };
}

export function readAnchors(source: { anchors?: WorkAnchors }): WorkAnchors {
  return source.anchors ?? EMPTY_WORK_ANCHORS;
}
