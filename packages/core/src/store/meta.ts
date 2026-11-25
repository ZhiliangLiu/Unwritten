import { PreviewSchema } from '@unwritten/contracts';
import { z } from 'zod';

export const StoredOptionSchema = z.object({ text: z.string() });
export const StoredSceneSchema = z.object({ place: z.string(), time: z.string(), present: z.array(z.string()) });
export const StoredActionSchema = z.object({ text: z.string(), optionIndex: z.number().int().nullable() });

export const PlanItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  source: z.enum(['author', 'ai', 'author_confirmed']),
});

export const PUBLIC_SETTING_PLAN_ITEM_ID = 'public_setting';

export const VersionMetaSchema = z.object({
  background: z.string(),
  plan: z.object({ items: z.array(PlanItemSchema) }).optional(),
  opening: z.object({ prose: z.string(), options: z.array(StoredOptionSchema), scene: StoredSceneSchema }).optional(),
  narration: z.object({ language: z.string() }).optional(),
});

export const PreviewJobInputSchema = z.object({ contentRev: z.number().int().nonnegative(), background: z.string() });
export const PreviewJobResultSchema = z.object({
  preview: PreviewSchema,
  adoption: z.object({ versionId: z.string(), routeId: z.string() }).nullable(),
});

export const TurnRequestLogSchema = z.array(
  z.object({ tool: z.string(), ok: z.boolean(), errors: z.array(z.string()) }),
);

export type StoredOption = z.infer<typeof StoredOptionSchema>;
export type StoredScene = z.infer<typeof StoredSceneSchema>;
export type StoredAction = z.infer<typeof StoredActionSchema>;
export type VersionMeta = z.infer<typeof VersionMetaSchema>;
export type PreviewJobInput = z.infer<typeof PreviewJobInputSchema>;
export type PreviewJobResult = z.infer<typeof PreviewJobResultSchema>;
export type TurnRequestLog = z.infer<typeof TurnRequestLogSchema>;
