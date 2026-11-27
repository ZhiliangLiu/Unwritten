import { z } from 'zod';
import { ErrorCodeSchema } from '../errors.ts';
import { UuidSchema } from './common.ts';

const ClientAreaSchema = z.enum(['library', 'authoring', 'play', 'settings', 'app', 'render', 'events']);
const SampleBase = {
  kind: z.literal('sample'),
  durationMs: z.number().finite().nonnegative(),
  outcome: z.enum(['ok', 'error', 'interrupted']),
};

export const ClientLogInputSchema = z.union([
  z.strictObject({ kind: z.literal('event'), area: ClientAreaSchema, code: ErrorCodeSchema }),
  z.discriminatedUnion('metric', [
    z.strictObject({ ...SampleBase, metric: z.literal('client.library_ready') }),
    z.strictObject({
      ...SampleBase,
      metric: z.literal('client.preview_visible'),
      workId: UuidSchema.optional(),
      jobId: UuidSchema,
    }),
    z.strictObject({
      ...SampleBase,
      metric: z.literal('client.plan_visible'),
      workId: UuidSchema.optional(),
      jobId: UuidSchema,
    }),
    z.strictObject({
      ...SampleBase,
      metric: z.literal('client.turn_visible'),
      workId: UuidSchema.optional(),
      requestId: UuidSchema,
      attempt: z.number().int().positive().optional(),
    }),
  ]),
]);

export type ClientLogInput = z.infer<typeof ClientLogInputSchema>;
