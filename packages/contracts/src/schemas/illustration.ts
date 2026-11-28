import { z } from 'zod';
import { ErrorCodeSchema } from '../errors.ts';
import { TimestampSchema, UuidSchema } from './common.ts';
import {
  AspectPreferenceSchema,
  AspectSchema,
  ImageSizeSchema,
  ImageTierPreferenceSchema,
  OutputPreferencesSchema,
} from './image.ts';

export const STYLE_PRESETS = ['watercolor', 'ink', 'anime', 'painterly', 'cinematic'] as const;
export const StylePresetSchema = z.enum(STYLE_PRESETS);
export const ILLUSTRATION_STYLE_TEXT_MAX_LENGTH = 200;
export const IllustrationStyleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), preset: StylePresetSchema }),
  z.object({
    kind: z.literal('custom'),
    text: z
      .string()
      .trim()
      .min(1)
      .max(ILLUSTRATION_STYLE_TEXT_MAX_LENGTH)
      .regex(/^[^\r\n]*$/u),
  }),
]);
export type IllustrationStyle = z.infer<typeof IllustrationStyleSchema>;
export const DEFAULT_ILLUSTRATION_STYLE: IllustrationStyle = { kind: 'preset', preset: 'painterly' };

export const APPEARANCE_MAX_LENGTH = 300;
export const AppearanceTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(APPEARANCE_MAX_LENGTH)
  .regex(/^[^\r\n]*$/u);

export const StartIllustrationInputSchema = z.object({
  enabled: z.boolean(),
  style: IllustrationStyleSchema,
  aspectPreference: AspectPreferenceSchema,
  resolutionTier: ImageTierPreferenceSchema,
  protagonistInFrame: z.boolean(),
  protagonistAppearance: AppearanceTextSchema.nullable(),
  protagonistSnapshotId: UuidSchema.nullable(),
});

export const StartIllustrationInfoSchema = z.object({
  available: z.boolean(),
  autoEnabled: z.boolean(),
  authorStyle: IllustrationStyleSchema,
  lastStyle: IllustrationStyleSchema.nullable(),
  defaults: OutputPreferencesSchema,
  protagonistEntityId: z.string().nullable(),
});
export const DEFAULT_START_ILLUSTRATION_INFO = {
  available: false,
  autoEnabled: false,
  authorStyle: DEFAULT_ILLUSTRATION_STYLE,
  lastStyle: null,
  defaults: { aspectPreference: 'auto', resolutionTier: '1k' },
  protagonistEntityId: null,
} as const;

export const ILLUSTRATION_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled', 'dismissed'] as const;
export const IllustrationStatusSchema = z.enum(ILLUSTRATION_STATUSES);
export const ILLUSTRATION_STAGES = ['wake', 'appearance', 'shot', 'portrait', 'generate', 'save'] as const;
export const IllustrationStageSchema = z.enum(ILLUSTRATION_STAGES);

export const IllustrationFormatSchema = z.object({
  aspectPreference: AspectSchema,
  resolutionTier: ImageTierPreferenceSchema,
  size: ImageSizeSchema.nullable(),
});

export const IllustrationViewSchema = z.object({
  id: UuidSchema,
  updatedAt: TimestampSchema,
  status: IllustrationStatusSchema,
  rerolling: z.boolean(),
  para: z.number().int().nonnegative(),
  format: IllustrationFormatSchema.nullable(),
  image: ImageSizeSchema.nullable(),
  caption: z.string().nullable(),
  error: ErrorCodeSchema.nullable(),
  stage: IllustrationStageSchema.nullable(),
  serviceId: z.string().nullable(),
});

export const IllustrationActionInputSchema = z.object({
  requestId: UuidSchema,
  illustrationId: UuidSchema,
  format: OutputPreferencesSchema.nullable().default(null),
});
export const DismissIllustrationInputSchema = z.object({ requestId: UuidSchema, illustrationId: UuidSchema });

export const PORTRAIT_SLOTS = ['front', 'three_quarter', 'full_body'] as const;
export const PortraitSlotSchema = z.enum(PORTRAIT_SLOTS);
export const PORTRAIT_SCOPES = ['work', 'pending', 'playthrough'] as const;
export const PortraitScopeSchema = z.enum(PORTRAIT_SCOPES);
export const PORTRAIT_STATES = ['draft', 'active', 'retired'] as const;
export const PortraitStateSchema = z.enum(PORTRAIT_STATES);

export const PortraitSlotViewSchema = z.object({
  slot: PortraitSlotSchema,
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).nullable(),
  source: z.enum(['import', 'generate']).nullable(),
  needsReview: z.boolean(),
  task: z.object({ status: z.enum(['running', 'failed']), error: ErrorCodeSchema.nullable() }).nullable(),
});

export const PortraitSetViewSchema = z.object({
  id: UuidSchema,
  workId: UuidSchema,
  scope: PortraitScopeSchema,
  entityId: z.string().nullable(),
  state: PortraitStateSchema,
  draftRev: z.number().int().nonnegative(),
  appearance: z.string(),
  slots: z.array(PortraitSlotViewSchema).length(3),
  updatedAt: TimestampSchema,
});

export const PortraitTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity'), entityId: z.string().min(1) }),
  z.object({ kind: z.literal('protagonist') }),
]);

export const PortraitDraftInputSchema = z.object({
  workId: UuidSchema,
  scope: z.enum(['work', 'pending']),
  target: PortraitTargetSchema,
  appearance: AppearanceTextSchema.nullable(),
});
export const PortraitDraftViewSchema = z.object({
  draft: PortraitSetViewSchema,
  activeSetId: UuidSchema.nullable(),
});
export const PortraitGetInputSchema = z.object({ setId: UuidSchema });

export const PortraitUploadInputSchema = z.object({
  requestId: UuidSchema,
  setId: UuidSchema,
  slot: PortraitSlotSchema,
  expectedRev: z.number().int().nonnegative(),
  file: z.file(),
});
export const PortraitGenerateInputSchema = z.object({
  requestId: UuidSchema,
  setId: UuidSchema,
  slot: PortraitSlotSchema,
  expectedRev: z.number().int().nonnegative(),
  format: OutputPreferencesSchema.nullable().default(null),
});
export const PortraitUpdateInputSchema = z.object({
  requestId: UuidSchema,
  setId: UuidSchema,
  expectedRev: z.number().int().nonnegative(),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('remove'), slot: PortraitSlotSchema }),
    z.object({ kind: z.literal('confirm'), slot: PortraitSlotSchema }),
  ]),
});
export const PortraitAdoptInputSchema = z.object({
  requestId: UuidSchema,
  setId: UuidSchema,
  expectedRev: z.number().int().nonnegative(),
  mode: z.enum(['adopt', 'retire']),
  expectedActiveSetId: UuidSchema.nullable(),
});
export const PortraitPreviewInputSchema = z.object({
  requestId: UuidSchema,
  workId: UuidSchema,
  style: IllustrationStyleSchema,
});

export const ImageFileInputSchema = z.object({
  view: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('work'), workId: UuidSchema }),
    z.object({ kind: z.literal('route'), routeId: UuidSchema }),
  ]),
  image: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('illustration'), illustrationId: UuidSchema }),
    z.object({ kind: z.literal('portrait'), setId: UuidSchema, slot: PortraitSlotSchema }),
  ]),
});

export const SuggestAppearanceInputSchema = z.object({ workId: UuidSchema });
export const SuggestAppearanceOutputSchema = z.object({ appearance: z.string() });
export const SetIllustrationStyleInputSchema = z.object({
  workId: UuidSchema,
  style: IllustrationStyleSchema.nullable(),
});

export type StylePreset = (typeof STYLE_PRESETS)[number];
export type AppearanceText = z.infer<typeof AppearanceTextSchema>;
export type StartIllustrationInput = z.infer<typeof StartIllustrationInputSchema>;
export type StartIllustrationInfo = z.infer<typeof StartIllustrationInfoSchema>;
export type IllustrationStatus = (typeof ILLUSTRATION_STATUSES)[number];
export type IllustrationStage = (typeof ILLUSTRATION_STAGES)[number];
export type IllustrationFormat = z.infer<typeof IllustrationFormatSchema>;
export type IllustrationView = z.infer<typeof IllustrationViewSchema>;
export type IllustrationActionInput = z.infer<typeof IllustrationActionInputSchema>;
export type DismissIllustrationInput = z.infer<typeof DismissIllustrationInputSchema>;
export type PortraitSlot = (typeof PORTRAIT_SLOTS)[number];
export type PortraitScope = (typeof PORTRAIT_SCOPES)[number];
export type PortraitState = (typeof PORTRAIT_STATES)[number];
export type PortraitSlotView = z.infer<typeof PortraitSlotViewSchema>;
export type PortraitSetView = z.infer<typeof PortraitSetViewSchema>;
export type PortraitTarget = z.infer<typeof PortraitTargetSchema>;
export type PortraitDraftInput = z.infer<typeof PortraitDraftInputSchema>;
export type PortraitDraftView = z.infer<typeof PortraitDraftViewSchema>;
export type PortraitGetInput = z.infer<typeof PortraitGetInputSchema>;
export type PortraitUploadInput = z.infer<typeof PortraitUploadInputSchema>;
export type PortraitGenerateInput = z.infer<typeof PortraitGenerateInputSchema>;
export type PortraitUpdateInput = z.infer<typeof PortraitUpdateInputSchema>;
export type PortraitAdoptInput = z.infer<typeof PortraitAdoptInputSchema>;
export type PortraitPreviewInput = z.infer<typeof PortraitPreviewInputSchema>;
export type ImageFileInput = z.infer<typeof ImageFileInputSchema>;
export type SuggestAppearanceInput = z.infer<typeof SuggestAppearanceInputSchema>;
export type SuggestAppearanceOutput = z.infer<typeof SuggestAppearanceOutputSchema>;
export type SetIllustrationStyleInput = z.infer<typeof SetIllustrationStyleInputSchema>;
