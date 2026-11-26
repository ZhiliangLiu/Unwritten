import { z } from 'zod';
import { ErrorCodeSchema } from '../errors.ts';
import { ContentRevSchema, LanguageTagSchema, TimestampSchema, UuidSchema } from './common.ts';
import { EntityKindSchema } from './story.ts';

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

export const PreviewSchema = z.object({
  title: z.string(),
  blurb: z.string(),
  publicSetting: z.string(),
  prose: z.string(),
  options: z.array(z.object({ text: z.string() })),
  scene: z.object({ place: z.string(), time: z.string() }),
  language: LanguageTagSchema,
  cast: z.array(PreviewCastMemberSchema).default([]),
});

export const JobStatusSchema = z.enum(['running', 'done', 'failed']);

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
  routeId: UuidSchema.nullable(),
  draft: z.object({ contentRev: ContentRevSchema, background: z.string(), anchors: WorkAnchorsSchema }),
  latestPreviewJob: PreviewJobViewSchema.nullable(),
});

export const WorkIdInputSchema = z.object({ workId: UuidSchema });

export const SaveDraftInputSchema = z.object({
  workId: UuidSchema,
  baseContentRev: ContentRevSchema,
  background: z.string().max(BACKGROUND_MAX_LENGTH),
  anchors: WorkAnchorsSchema.default(EMPTY_WORK_ANCHORS),
});
export const SaveDraftOutputSchema = z.object({ contentRev: ContentRevSchema });

export const GeneratePreviewInputSchema = z.object({
  workId: UuidSchema,
  jobId: UuidSchema,
  contentRev: ContentRevSchema,
});

export const AdoptPreviewInputSchema = z.object({ workId: UuidSchema, jobId: UuidSchema });
export const AdoptPreviewOutputSchema = z.object({ routeId: UuidSchema });

export type WorkAnchors = z.infer<typeof WorkAnchorsSchema>;
export type WorkStatus = z.infer<typeof WorkStatusSchema>;
export type WorkSummary = z.infer<typeof WorkSummarySchema>;
export type Preview = z.infer<typeof PreviewSchema>;
export type PreviewCastMember = z.infer<typeof PreviewCastMemberSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type PreviewJobView = z.infer<typeof PreviewJobViewSchema>;
export type WorkDetail = z.infer<typeof WorkDetailSchema>;
export type WorkIdInput = z.infer<typeof WorkIdInputSchema>;
export type SaveDraftInput = z.input<typeof SaveDraftInputSchema>;
export type SaveDraftOutput = z.infer<typeof SaveDraftOutputSchema>;
export type GeneratePreviewInput = z.infer<typeof GeneratePreviewInputSchema>;
export type AdoptPreviewInput = z.infer<typeof AdoptPreviewInputSchema>;
export type AdoptPreviewOutput = z.infer<typeof AdoptPreviewOutputSchema>;
