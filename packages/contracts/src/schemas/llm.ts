import { z } from 'zod';
import { ErrorCodeSchema } from '../errors.ts';
import { UuidSchema } from './common.ts';

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const ThinkingLevelSchema = z.enum(THINKING_LEVELS);

export const THINKING_FORMATS = [
  'auto',
  'openai',
  'qwen',
  'qwen-chat-template',
  'deepseek',
  'openrouter',
  'zai',
] as const;
export const ThinkingFormatSchema = z.enum(THINKING_FORMATS);

export const PURPOSES = ['default', 'narrator', 'background'] as const;
export const PurposeSchema = z.enum(PURPOSES);

export const GENERATION_LIMITS = { thinkingBudgetMax: 1_000_000, temperatureMax: 2, topKMax: 1_000 } as const;

export const GenerationParamsSchema = z.object({
  thinking: ThinkingLevelSchema.nullable(),
  thinkingBudget: z.number().int().positive().max(GENERATION_LIMITS.thinkingBudgetMax).nullable(),
  temperature: z.number().min(0).max(GENERATION_LIMITS.temperatureMax).nullable(),
  topP: z.number().gt(0).max(1).nullable(),
  topK: z.number().int().positive().max(GENERATION_LIMITS.topKMax).nullable(),
  minP: z.number().min(0).max(1).nullable(),
});

export const EMPTY_GENERATION_PARAMS = {
  thinking: null,
  thinkingBudget: null,
  temperature: null,
  topP: null,
  topK: null,
  minP: null,
} as const satisfies z.infer<typeof GenerationParamsSchema>;

export const ModelCapabilitiesSchema = z.object({
  id: z.string().min(1),
  contextWindow: z.number().int().positive().nullable(),
  maxTokens: z.number().int().positive().nullable(),
  tools: z.boolean().nullable(),
  reasoning: z.boolean().nullable(),
  thinkingFormat: ThinkingFormatSchema,
});

export const KeyStatusSchema = z.object({
  hasKey: z.boolean(),
  source: z.enum(['file', 'env', 'none']),
  envVar: z.string().nullable(),
});

export const EndpointViewSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  api: z.enum(['openai-completions', 'anthropic-messages']),
  baseUrl: z.string(),
  key: KeyStatusSchema,
  models: z.array(ModelCapabilitiesSchema),
});

export const ModelRefSchema = z.object({ endpointId: z.string().min(1), modelId: z.string().min(1) });

export const ConfigProblemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('syntax'),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    message: z.string(),
  }),
  z.object({ kind: z.literal('schema'), path: z.string(), message: z.string() }),
  z.object({ kind: z.literal('too_new'), version: z.number().int() }),
]);

export const PurposeProblemSchema = z.enum(['not_configured', 'model_missing', 'no_tools']);

export const PurposeViewSchema = z.object({
  purpose: PurposeSchema,
  model: ModelRefSchema.nullable(),
  params: GenerationParamsSchema,
  inherited: z.boolean(),
  effectiveModel: ModelRefSchema.nullable(),
  effectiveParams: GenerationParamsSchema,
  problem: PurposeProblemSchema.nullable(),
});

export const LlmConfigViewSchema = z.object({
  status: z.enum(['ok', 'missing', 'invalid', 'too_new']),
  revision: z.string(),
  problem: ConfigProblemSchema.nullable(),
  endpoints: z.array(EndpointViewSchema),
  purposes: z.array(PurposeViewSchema),
});

const EndpointNameSchema = z.string().trim().min(1).max(60);
const BaseUrlInputSchema = z.string().trim().min(1).max(2048);
const ModelIdSchema = z.string().trim().min(1).max(200);
const ApiKeyValueSchema = z.string().trim().min(1).max(4096);

export const CreateEndpointInputSchema = z.object({
  requestId: UuidSchema,
  baseRevision: z.string(),
  name: EndpointNameSchema,
  baseUrl: BaseUrlInputSchema,
  modelId: ModelIdSchema,
  apiKey: ApiKeyValueSchema.nullable(),
  makeDefault: z.boolean(),
});

export const CreateEndpointOutputSchema = z.object({ endpointId: z.string(), config: LlmConfigViewSchema });

export const KeyChangeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep') }),
  z.object({ action: z.literal('set'), value: ApiKeyValueSchema }),
  z.object({ action: z.literal('remove') }),
]);

export const UpdateEndpointInputSchema = z.object({
  baseRevision: z.string(),
  endpointId: z.string().min(1),
  name: EndpointNameSchema,
  key: KeyChangeSchema,
});

export const SetPurposeInputSchema = z.object({
  baseRevision: z.string(),
  purpose: PurposeSchema,
  model: ModelRefSchema.nullable(),
  params: GenerationParamsSchema.default(EMPTY_GENERATION_PARAMS),
});

export const AddModelInputSchema = z.object({
  baseRevision: z.string(),
  endpointId: z.string().min(1),
  modelId: ModelIdSchema,
});

export const UpdateModelInputSchema = z.object({
  baseRevision: z.string(),
  endpointId: z.string().min(1),
  modelId: ModelIdSchema,
  reasoning: z.boolean().nullable(),
  thinkingFormat: ThinkingFormatSchema,
});

export const RemoveModelInputSchema = z.object({
  baseRevision: z.string(),
  endpointId: z.string().min(1),
  modelId: ModelIdSchema,
});

export const RemoveEndpointInputSchema = z.object({
  baseRevision: z.string(),
  endpointId: z.string().min(1),
});

export const TestKeySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), value: ApiKeyValueSchema }),
  z.object({ action: z.literal('keep'), endpointId: z.string().min(1) }),
  z.object({ action: z.literal('none') }),
]);

export const TestDraftConnectionInputSchema = z.object({
  baseUrl: BaseUrlInputSchema,
  modelId: ModelIdSchema,
  key: TestKeySchema,
});

export const TestPurposeConnectionInputSchema = z.object({ purpose: PurposeSchema });

export const TestConnectionInputSchema = z.union([TestDraftConnectionInputSchema, TestPurposeConnectionInputSchema]);

export const TestConnectionResultSchema = z.object({
  ok: z.boolean(),
  code: ErrorCodeSchema.nullable(),
  detail: z.string().nullable(),
  savedToolsCapability: z.boolean(),
});

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;
export type KeyStatus = z.infer<typeof KeyStatusSchema>;
export type EndpointView = z.infer<typeof EndpointViewSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
export type ConfigProblem = z.infer<typeof ConfigProblemSchema>;
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;
export type ThinkingFormat = z.infer<typeof ThinkingFormatSchema>;
export type LlmPurpose = z.infer<typeof PurposeSchema>;
export type GenerationParams = z.infer<typeof GenerationParamsSchema>;
export type PurposeProblem = z.infer<typeof PurposeProblemSchema>;
export type PurposeView = z.infer<typeof PurposeViewSchema>;
export type LlmConfigView = z.infer<typeof LlmConfigViewSchema>;
export type CreateEndpointInput = z.infer<typeof CreateEndpointInputSchema>;
export type CreateEndpointOutput = z.infer<typeof CreateEndpointOutputSchema>;
export type KeyChange = z.infer<typeof KeyChangeSchema>;
export type UpdateEndpointInput = z.infer<typeof UpdateEndpointInputSchema>;
export type SetPurposeInput = z.infer<typeof SetPurposeInputSchema>;
export type AddModelInput = z.infer<typeof AddModelInputSchema>;
export type UpdateModelInput = z.infer<typeof UpdateModelInputSchema>;
export type RemoveModelInput = z.infer<typeof RemoveModelInputSchema>;
export type RemoveEndpointInput = z.infer<typeof RemoveEndpointInputSchema>;
export type TestKey = z.infer<typeof TestKeySchema>;
export type TestDraftConnectionInput = z.infer<typeof TestDraftConnectionInputSchema>;
export type TestPurposeConnectionInput = z.infer<typeof TestPurposeConnectionInputSchema>;
export type TestConnectionInput = z.infer<typeof TestConnectionInputSchema>;
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;
