import { z } from 'zod';
import { ErrorCodeSchema } from '../errors.ts';
import { LanguageTagSchema, TimestampSchema, UuidSchema } from './common.ts';

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
  prose: z.string(),
  options: z.array(z.object({ text: z.string() })),
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
  turns: z.array(TurnViewSchema),
  pending: TurnRequestViewSchema.nullable(),
});

export const RouteIdInputSchema = z.object({ routeId: UuidSchema });

export const SubmitActionInputSchema = z.object({
  requestId: UuidSchema,
  routeId: UuidSchema,
  expectedHeadTurnId: UuidSchema,
  action: PlayerActionInputSchema,
});

export const RetryInputSchema = z.object({ requestId: UuidSchema });

export type PlayerActionInput = z.infer<typeof PlayerActionInputSchema>;
export type ActionView = z.infer<typeof ActionViewSchema>;
export type TurnView = z.infer<typeof TurnViewSchema>;
export type TurnRequestStatus = z.infer<typeof TurnRequestStatusSchema>;
export type TurnRequestView = z.infer<typeof TurnRequestViewSchema>;
export type RouteView = z.infer<typeof RouteViewSchema>;
export type RouteIdInput = z.infer<typeof RouteIdInputSchema>;
export type SubmitActionInput = z.infer<typeof SubmitActionInputSchema>;
export type RetryInput = z.infer<typeof RetryInputSchema>;
