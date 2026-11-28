import { z } from 'zod';
import { ErrorCodeSchema } from '../errors.ts';
import { CastModeSchema, ProtagonistFieldSchema } from './authoring.ts';
import { LanguageTagSchema, TimestampSchema, UuidSchema } from './common.ts';
import {
  DEFAULT_START_ILLUSTRATION_INFO,
  IllustrationViewSchema,
  StartIllustrationInfoSchema,
  StartIllustrationInputSchema,
} from './illustration.ts';
import { OptionViewSchema } from './works.ts';

export const ACTION_TEXT_MAX_LENGTH = 2_000;

export const PlayerActionInputSchema = z.object({
  text: z.string().trim().min(1).max(ACTION_TEXT_MAX_LENGTH),
  optionIndex: z.number().int().min(1).max(9).nullable(),
});

export const ActionViewSchema = z.object({ text: z.string(), optionIndex: z.number().int().nullable() });

export const TurnViewSchema = z.object({
  id: UuidSchema,
  originRequest: z.object({ id: UuidSchema, attempt: z.number().int().positive() }).nullable(),
  depth: z.number().int().nonnegative(),
  action: ActionViewSchema.nullable(),
  paragraphs: z.array(z.string()),
  options: z.array(OptionViewSchema),
  illustration: IllustrationViewSchema.nullable().default(null),
  createdAt: TimestampSchema,
});

export const TurnRequestStatusSchema = z.enum([
  'running',
  'needs_clarification',
  'done',
  'failed',
  'superseded',
  'cancelled',
]);

export const TurnRequestViewSchema = z.object({
  id: UuidSchema,
  status: TurnRequestStatusSchema,
  action: ActionViewSchema,
  error: ErrorCodeSchema.nullable(),
  attempts: z.number().int().positive(),
  expectedHeadTurnId: UuidSchema,
  resultTurnId: UuidSchema.nullable(),
  updatedAt: TimestampSchema,
});

export const RouteViewSchema = z.object({
  id: UuidSchema,
  workId: UuidSchema,
  workTitle: z.string().nullable(),
  language: LanguageTagSchema,
  headTurnId: UuidSchema,
  playthroughId: UuidSchema.nullable().default(null),
  turns: z.array(TurnViewSchema),
  pending: TurnRequestViewSchema.nullable(),
  ended: z.boolean().default(false),
});

export const RouteIdInputSchema = z.object({ routeId: UuidSchema });

export const SubmitActionInputSchema = z.object({
  requestId: UuidSchema,
  routeId: UuidSchema,
  expectedHeadTurnId: UuidSchema,
  action: PlayerActionInputSchema,
});

export const RetryInputSchema = z.object({ requestId: UuidSchema });

export const StartInfoSchema = z.object({
  workId: UuidSchema,
  title: z.string().nullable(),
  fields: z.array(ProtagonistFieldSchema),
  castMode: CastModeSchema,
  illustration: StartIllustrationInfoSchema.default(DEFAULT_START_ILLUSTRATION_INFO),
});

export const StartPlaythroughInputSchema = z.object({
  workId: UuidSchema,
  playthroughId: UuidSchema,
  illustration: StartIllustrationInputSchema.optional(),
  protagonist: z.record(
    z.string().min(1).max(20),
    z
      .string()
      .max(40)
      .regex(/^[^\r\n]*$/u),
  ),
});

export const OpeningRequestViewSchema = z.object({
  id: UuidSchema,
  status: TurnRequestStatusSchema,
  error: ErrorCodeSchema.nullable(),
  attempts: z.number().int().positive(),
  updatedAt: TimestampSchema,
});

export const PlaythroughViewSchema = z.object({
  id: UuidSchema,
  workId: UuidSchema,
  workTitle: z.string().nullable(),
  routeId: UuidSchema.nullable(),
  opening: OpeningRequestViewSchema.nullable(),
});

export const PlaythroughListItemSchema = z.object({
  id: UuidSchema,
  routeId: UuidSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  protagonistName: z.string().nullable(),
  place: z.string().nullable(),
  time: z.string().nullable(),
  turnCount: z.number().int().nonnegative().nullable(),
  ended: z.boolean(),
});

export const PlaythroughIdInputSchema = z.object({ playthroughId: UuidSchema });

export const RetryOpeningInputSchema = z.object({ requestId: UuidSchema });

export const StatusHistoryEntrySchema = z.object({
  turnId: UuidSchema,
  depth: z.number().int().nonnegative(),
  text: z.string(),
});

export const StatusValueSchema = z.discriminatedUnion('display', [
  z.object({
    display: z.literal('number'),
    value: z.number(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    unit: z.string().nullable(),
    previous: z.number().nullable(),
  }),
  z.object({
    display: z.literal('stage'),
    stage: z.string(),
    step: z.number().int().positive(),
    total: z.number().int().positive(),
    previousStep: z.number().int().positive().nullable(),
  }),
  z.object({
    display: z.literal('list'),
    items: z.array(
      z.object({
        item: z.string(),
        status: z.enum(['open', 'done', 'failed']),
        change: z.enum(['new', 'changed']).nullable(),
      }),
    ),
  }),
  z.object({
    display: z.literal('text'),
    value: z.string(),
    previous: z.string().nullable(),
  }),
]);

export const StatusColumnViewSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  isNew: z.boolean(),
  changed: z.boolean(),
  value: StatusValueSchema,
  history: z.array(StatusHistoryEntrySchema),
});

export const StatusViewSchema = z.object({
  routeId: UuidSchema,
  headTurnId: UuidSchema,
  columns: z.array(StatusColumnViewSchema),
  closed: z.array(StatusColumnViewSchema),
});

export type PlayerActionInput = z.infer<typeof PlayerActionInputSchema>;
export type ActionView = z.infer<typeof ActionViewSchema>;
export type TurnView = z.infer<typeof TurnViewSchema>;
export type TurnRequestStatus = z.infer<typeof TurnRequestStatusSchema>;
export type TurnRequestView = z.infer<typeof TurnRequestViewSchema>;
export type RouteView = z.infer<typeof RouteViewSchema>;
export type RouteIdInput = z.infer<typeof RouteIdInputSchema>;
export type SubmitActionInput = z.infer<typeof SubmitActionInputSchema>;
export type RetryInput = z.infer<typeof RetryInputSchema>;
export type StartInfo = z.infer<typeof StartInfoSchema>;
export type StartPlaythroughInput = z.infer<typeof StartPlaythroughInputSchema>;
export type OpeningRequestView = z.infer<typeof OpeningRequestViewSchema>;
export type PlaythroughView = z.infer<typeof PlaythroughViewSchema>;
export type PlaythroughListItem = z.infer<typeof PlaythroughListItemSchema>;
export type PlaythroughIdInput = z.infer<typeof PlaythroughIdInputSchema>;
export type RetryOpeningInput = z.infer<typeof RetryOpeningInputSchema>;
export type StatusHistoryEntry = z.infer<typeof StatusHistoryEntrySchema>;
export type StatusValue = z.infer<typeof StatusValueSchema>;
export type StatusColumnView = z.infer<typeof StatusColumnViewSchema>;
export type StatusView = z.infer<typeof StatusViewSchema>;
