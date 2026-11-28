import { z } from 'zod';
import { ErrorCodeSchema } from '../errors.ts';
import {
  JobStatusSchema,
  PlanItemSchema,
  PlanJobViewSchema,
  PlanViewSchema,
  WorkSettingsSchema,
  WizardStepSchema,
} from './authoring.ts';
import { ContentRevSchema, LanguageTagSchema, TimestampSchema, UuidSchema } from './common.ts';
import { IllustrationStyleSchema } from './illustration.ts';
import { EntityKindSchema } from './story.ts';

export const NOVEL_IMPORT_MAX_BYTES = 64 * 1024 * 1024;
export const NOVEL_IMPORT_PART_BYTES = 1024 * 1024;
export const NOVEL_IMPORT_MAX_BODY_BYTES = NOVEL_IMPORT_PART_BYTES + 64 * 1024;

export const BACKGROUND_MAX_LENGTH = 20_000;

export const WorkAnchorsSchema = z.object({
  narrationDirective: z.string(),
  contentPolicy: z.string(),
  improvisationScope: z.string(),
});

export const EMPTY_WORK_ANCHORS: WorkAnchors = {
  narrationDirective: '',
  contentPolicy: '',
  improvisationScope: '',
};

export const WorkStatusSchema = z.enum(['draft', 'playable']);

export const WorkSummarySchema = z.object({
  id: UuidSchema,
  title: z.string().nullable(),
  blurb: z.string().nullable(),
  label: z.string(),
  status: WorkStatusSchema,
  hasProgress: z.boolean(),
  hasMultiplePlaythroughs: z.boolean().default(false),
  hasUnpublishedChanges: z.boolean(),
  routeId: UuidSchema.nullable(),
  updatedAt: TimestampSchema,
});

export const PreviewCastMemberSchema = z.object({
  kind: EntityKindSchema,
  name: z.string(),
  knownAs: z.string().nullable(),
  profile: z.string(),
  protagonist: z.boolean(),
});

export const OptionViewSchema = z.object({ text: z.string(), hint: z.string().nullable().default(null) });
export type OptionView = z.infer<typeof OptionViewSchema>;

export const NeedsReviewSchema = z.object({
  where: z.enum(['prose', 'option']),
  index: z.number().int().positive(),
  text: z.string(),
  reason: z.enum(['hardcoded_name', 'unknown_placeholder']),
});
export type NeedsReview = z.infer<typeof NeedsReviewSchema>;

export const PreviewSchema = z.object({
  title: z.string(),
  blurb: z.string(),
  publicSetting: z.string(),
  prose: z.string(),
  options: z.array(OptionViewSchema),
  scene: z.object({ place: z.string(), time: z.string() }),
  language: LanguageTagSchema,
  cast: z.array(PreviewCastMemberSchema).default([]),
  needsReview: z.array(NeedsReviewSchema).default([]),
  initialState: z.array(z.object({ label: z.string(), text: z.string(), visible: z.boolean() })).default([]),
});

export const PreviewJobViewSchema = z.object({
  id: UuidSchema,
  status: JobStatusSchema,
  basedOnContentRev: ContentRevSchema,
  error: ErrorCodeSchema.nullable(),
  preview: PreviewSchema.nullable(),
  updatedAt: TimestampSchema,
});

export const WorkDetailSchema = z.object({
  id: UuidSchema,
  title: z.string().nullable(),
  blurb: z.string().nullable(),
  status: WorkStatusSchema,
  hasUnpublishedChanges: z.boolean(),
  routeCount: z.number().int().nonnegative(),
  draft: z.object({
    contentRev: ContentRevSchema,
    background: z.string(),
    anchors: WorkAnchorsSchema,
    settings: WorkSettingsSchema,
    wizardStep: WizardStepSchema,
    plan: PlanViewSchema.nullable(),
  }),
  latestPreviewJob: PreviewJobViewSchema.nullable(),
  latestPlanJob: PlanJobViewSchema.nullable(),
  novelImport: z
    .object({
      chapters: z.array(z.string()),
      chapter: z.number().int().nonnegative(),
      referenceChapter: z.number().int().nonnegative().optional(),
    })
    .optional(),
  illustrationStyle: IllustrationStyleSchema.nullable().default(null),
});

export const WorkIdInputSchema = z.object({ workId: UuidSchema });

export const ImportNovelInputSchema = WorkIdInputSchema.extend({
  file: z.file().max(NOVEL_IMPORT_PART_BYTES),
  offset: z.number().int().nonnegative().max(NOVEL_IMPORT_MAX_BYTES),
  totalBytes: z.number().int().nonnegative().max(NOVEL_IMPORT_MAX_BYTES),
});

export const SaveDraftInputSchema = z.object({
  workId: UuidSchema,
  baseContentRev: ContentRevSchema,
  background: z.string().max(BACKGROUND_MAX_LENGTH),
  anchors: WorkAnchorsSchema.default(EMPTY_WORK_ANCHORS),
  settings: WorkSettingsSchema,
});
export const SaveDraftOutputSchema = z.object({ contentRev: ContentRevSchema });

export const GeneratePreviewInputSchema = z.object({
  workId: UuidSchema,
  jobId: UuidSchema,
  contentRev: ContentRevSchema,
});

export const AdoptPreviewInputSchema = z.object({ workId: UuidSchema, jobId: UuidSchema });
export const AdoptPreviewOutputSchema = z.object({ routeId: UuidSchema.nullable() });

export const ApplyDraftInputSchema = z.object({
  workId: UuidSchema,
  baseContentRev: ContentRevSchema,
});

export const GeneratePlanInputSchema = z.object({
  workId: UuidSchema,
  jobId: UuidSchema,
  contentRev: ContentRevSchema,
  novelChapter: z.number().int().nonnegative().optional(),
  novelReferenceChapter: z.number().int().nonnegative().optional(),
});

export const AdoptStalePlanInputSchema = z.object({ workId: UuidSchema, jobId: UuidSchema });

export const UpdatePlanItemInputSchema = z.object({
  workId: UuidSchema,
  baseContentRev: ContentRevSchema,
  item: PlanItemSchema,
});

export const RemovePlanItemInputSchema = z.object({
  workId: UuidSchema,
  baseContentRev: ContentRevSchema,
  itemId: z.string().min(1).max(64),
});

export const ConfirmPlanInputSchema = z.object({
  workId: UuidSchema,
  baseContentRev: ContentRevSchema,
});

export const SetWizardStepInputSchema = z.object({
  workId: UuidSchema,
  step: WizardStepSchema,
});

export type WorkAnchors = z.infer<typeof WorkAnchorsSchema>;
export type WorkStatus = z.infer<typeof WorkStatusSchema>;
export type WorkSummary = z.infer<typeof WorkSummarySchema>;
export type Preview = z.infer<typeof PreviewSchema>;
export type PreviewCastMember = z.infer<typeof PreviewCastMemberSchema>;
export type PreviewJobView = z.infer<typeof PreviewJobViewSchema>;
export type WorkDetail = z.infer<typeof WorkDetailSchema>;
export type WorkIdInput = z.infer<typeof WorkIdInputSchema>;
export type ImportNovelInput = z.infer<typeof ImportNovelInputSchema>;
export type SaveDraftInput = z.input<typeof SaveDraftInputSchema>;
export type SaveDraftOutput = z.infer<typeof SaveDraftOutputSchema>;
export type GeneratePreviewInput = z.infer<typeof GeneratePreviewInputSchema>;
export type AdoptPreviewInput = z.infer<typeof AdoptPreviewInputSchema>;
export type AdoptPreviewOutput = z.infer<typeof AdoptPreviewOutputSchema>;
export type ApplyDraftInput = z.infer<typeof ApplyDraftInputSchema>;
export type GeneratePlanInput = z.infer<typeof GeneratePlanInputSchema>;
export type AdoptStalePlanInput = z.infer<typeof AdoptStalePlanInputSchema>;
export type UpdatePlanItemInput = z.infer<typeof UpdatePlanItemInputSchema>;
export type RemovePlanItemInput = z.infer<typeof RemovePlanItemInputSchema>;
export type ConfirmPlanInput = z.infer<typeof ConfirmPlanInputSchema>;
export type SetWizardStepInput = z.infer<typeof SetWizardStepInputSchema>;
