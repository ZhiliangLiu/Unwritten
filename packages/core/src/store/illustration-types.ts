import { z } from 'zod';
import {
  AppearanceTextSchema,
  AspectSchema,
  AutoIllustrationTargetSchema,
  ErrorCodeSchema,
  IllustrationFormatSchema,
  IllustrationStageSchema,
  IllustrationStyleSchema,
  ImageQualitySchema,
  OutputPreferencesSchema,
  PortraitSlotSchema,
  UuidSchema,
} from '@unwritten/contracts';

export const ImageFileRefSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/u),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});
export type ImageFileRef = z.infer<typeof ImageFileRefSchema>;

export const PlaythroughIllustrationSchema = z.object({
  enabled: z.boolean(),
  style: IllustrationStyleSchema,
  aspectPreference: OutputPreferencesSchema.shape.aspectPreference,
  resolutionTier: OutputPreferencesSchema.shape.resolutionTier,
  protagonistInFrame: z.boolean(),
  protagonistAppearance: AppearanceTextSchema.nullable(),
  authorPortraitSetIds: z.record(z.string(), UuidSchema),
  protagonistPortraitSetId: UuidSchema.nullable(),
});
export type PlaythroughIllustration = z.infer<typeof PlaythroughIllustrationSchema>;

export const TEXT_ONLY_PLAYTHROUGH_ILLUSTRATION = {
  enabled: false,
  style: { kind: 'preset', preset: 'painterly' },
  aspectPreference: 'auto',
  resolutionTier: '1k',
  protagonistInFrame: false,
  protagonistAppearance: null,
  authorPortraitSetIds: {},
  protagonistPortraitSetId: null,
} as const;

export const IllustrationSettingsSchema = z.object({
  autoEnabled: z.boolean(),
  confirmed: AutoIllustrationTargetSchema.nullable(),
  defaults: OutputPreferencesSchema,
});
export type IllustrationSettings = z.infer<typeof IllustrationSettingsSchema>;

export const DEFAULT_ILLUSTRATION_SETTINGS = {
  autoEnabled: false,
  confirmed: null,
  defaults: { aspectPreference: 'auto', resolutionTier: '1k' },
} as const;

export const ShotCapabilitySchema = z.object({
  aspects: z.array(AspectSchema),
  maxReferences: z.number().int().nonnegative(),
  negativePrompt: z.boolean(),
});
export type ShotCapability = z.infer<typeof ShotCapabilitySchema>;

export const ShotRefSchema = z.object({ entityId: z.string().min(1), view: PortraitSlotSchema });
export type ShotRef = z.infer<typeof ShotRefSchema>;

export const ReferenceFileSchema = z.object({
  setId: UuidSchema,
  slot: PortraitSlotSchema,
  file: ImageFileRefSchema,
});
export type ReferenceFile = z.infer<typeof ReferenceFileSchema>;

export const ShotRecordSchema = z.object({
  prompt: z.string().min(1),
  negativePrompt: z.string().nullable(),
  caption: z.string().min(1),
  refs: z.array(ShotRefSchema),
  capability: ShotCapabilitySchema,
});
export type ShotRecord = z.infer<typeof ShotRecordSchema>;

export const AttemptDataSchema = z.object({
  attemptId: UuidSchema,
  kind: z.enum(['first', 'retry', 'reroll']),
  formatOverride: OutputPreferencesSchema.nullable(),
  format: IllustrationFormatSchema.nullable(),
  shot: ShotRecordSchema.nullable(),
  referenceFiles: z.array(ReferenceFileSchema).nullable(),
  seed: z.number().int().nonnegative().nullable(),
  serviceId: z.string().nullable(),
  completed: z.array(IllustrationStageSchema),
});
export type AttemptData = z.infer<typeof AttemptDataSchema>;

export const PortraitSlotStoredSchema = z.object({
  file: ImageFileRefSchema.nullable(),
  source: z.enum(['import', 'generate']).nullable(),
  needsReview: z.boolean(),
});
export type PortraitSlotStored = z.infer<typeof PortraitSlotStoredSchema>;

export const PortraitSlotsStoredSchema = z.object({
  front: PortraitSlotStoredSchema,
  three_quarter: PortraitSlotStoredSchema,
  full_body: PortraitSlotStoredSchema,
});
export type PortraitSlotsStored = z.infer<typeof PortraitSlotsStoredSchema>;

export const EMPTY_PORTRAIT_SLOTS = {
  front: { file: null, source: null, needsReview: false },
  three_quarter: { file: null, source: null, needsReview: false },
  full_body: { file: null, source: null, needsReview: false },
} as const;

export const PortraitTaskSchema = z.object({
  attemptId: UuidSchema,
  status: z.enum(['running', 'failed']),
  error: ErrorCodeSchema.nullable(),
  format: IllustrationFormatSchema.nullable(),
  quality: ImageQualitySchema,
  inputFiles: z.array(ImageFileRefSchema),
  appearanceHash: z.string().nullable().default(null),
});
export type PortraitTask = z.infer<typeof PortraitTaskSchema>;

export const PortraitTasksSchema = z.object({
  front: PortraitTaskSchema.nullable(),
  three_quarter: PortraitTaskSchema.nullable(),
  full_body: PortraitTaskSchema.nullable(),
});
export type PortraitTasks = z.infer<typeof PortraitTasksSchema>;

export const EMPTY_PORTRAIT_TASKS = { front: null, three_quarter: null, full_body: null } as const;
