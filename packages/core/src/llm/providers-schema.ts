import { z } from "zod";

export const PROVIDERS_FILE_VERSION = 1;

const ModelEntrySchema = z.looseObject({
  id: z.string().min(1),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  tools: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  vision: z.boolean().optional(),
});

const EndpointEntrySchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  api: z.enum(["openai-completions", "anthropic-messages"]),
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  models: z.array(ModelEntrySchema),
});

const PurposeRefSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) });

export const ProvidersFileSchema = z.looseObject({
  version: z.literal(PROVIDERS_FILE_VERSION),
  providers: z.record(z.string(), z.looseObject({ apiKey: z.string().optional() })).default({}),
  endpoints: z.array(EndpointEntrySchema).default([]),
  purposes: z
    .object({
      default: PurposeRefSchema.optional(),
      narrator: PurposeRefSchema.optional(),
      author_chat: PurposeRefSchema.optional(),
      background: PurposeRefSchema.optional(),
    })
    .default({}),
});

export type ProvidersFile = z.infer<typeof ProvidersFileSchema>;
export type EndpointEntry = z.infer<typeof EndpointEntrySchema>;

export function emptyProvidersFile(): ProvidersFile {
  return { version: PROVIDERS_FILE_VERSION, providers: {}, endpoints: [], purposes: {} };
}
