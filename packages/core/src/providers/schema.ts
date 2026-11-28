import { z } from 'zod';
import {
  IdleMinutesSchema,
  IMAGE_PROTOCOLS,
  OpenAiImageOptionsSchema,
  ThinkingFormatSchema,
  ThinkingLevelSchema,
} from '@unwritten/contracts';

export const PROVIDERS_FILE_VERSION = 2;

const ModelEntrySchema = z.looseObject({
  id: z.string().min(1),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  tools: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  thinkingFormat: ThinkingFormatSchema.optional(),
  vision: z.boolean().optional(),
});

const EndpointEntrySchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  api: z.enum(['openai-completions', 'anthropic-messages']),
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  models: z.array(ModelEntrySchema),
});

const PurposeRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  params: z
    .object({
      thinking: ThinkingLevelSchema.optional(),
      thinkingBudget: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
      topP: z.number().gt(0).max(1).optional(),
      topK: z.number().int().positive().optional(),
      minP: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export const ImageServiceEntrySchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  protocol: z.enum(IMAGE_PROTOCOLS),
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  model: z.string().min(1).optional(),
  capabilities: OpenAiImageOptionsSchema.optional(),
  launcher: z.looseObject({ baseUrl: z.string().min(1), apiKey: z.string().optional() }).optional(),
  idleMinutes: IdleMinutesSchema.optional(),
});
export type ImageServiceEntry = z.infer<typeof ImageServiceEntrySchema>;

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
  imageServices: z.array(ImageServiceEntrySchema).default([]),
  image: z.object({ service: z.string().min(1).nullable() }).default({ service: null }),
});

export type ProvidersFile = z.infer<typeof ProvidersFileSchema>;
export type EndpointEntry = z.infer<typeof EndpointEntrySchema>;

export function emptyProvidersFile(): ProvidersFile {
  return {
    version: PROVIDERS_FILE_VERSION,
    providers: {},
    endpoints: [],
    purposes: {},
    imageServices: [],
    image: { service: null },
  };
}
