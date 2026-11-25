import { z } from "zod";
import { ErrorCodeSchema } from "../errors.ts";
import { UuidSchema } from "./common.ts";

export const ModelCapabilitiesSchema = z.object({
  id: z.string().min(1),
  contextWindow: z.number().int().positive().nullable(),
  maxTokens: z.number().int().positive().nullable(),
  tools: z.boolean().nullable(),
});

export const KeyStatusSchema = z.object({
  hasKey: z.boolean(),
  source: z.enum(["file", "env", "none"]),
  envVar: z.string().nullable(),
});

export const EndpointViewSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  api: z.enum(["openai-completions", "anthropic-messages"]),
  baseUrl: z.string(),
  key: KeyStatusSchema,
  models: z.array(ModelCapabilitiesSchema),
});

export const ModelRefSchema = z.object({ endpointId: z.string().min(1), modelId: z.string().min(1) });

export const ConfigProblemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("syntax"),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    message: z.string(),
  }),
  z.object({ kind: z.literal("schema"), path: z.string(), message: z.string() }),
  z.object({ kind: z.literal("too_new"), version: z.number().int() }),
]);

export const LlmConfigViewSchema = z.object({
  status: z.enum(["ok", "missing", "invalid", "too_new"]),
  revision: z.string(),
  problem: ConfigProblemSchema.nullable(),
  endpoints: z.array(EndpointViewSchema),
  defaultModel: ModelRefSchema.nullable(),
  defaultModelUsable: z.boolean(),
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

export const KeyChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }),
  z.object({ action: z.literal("set"), value: ApiKeyValueSchema }),
  z.object({ action: z.literal("remove") }),
]);

export const UpdateEndpointInputSchema = z.object({
  baseRevision: z.string(),
  endpointId: z.string().min(1),
  name: EndpointNameSchema,
  modelId: ModelIdSchema,
  key: KeyChangeSchema,
});

export const SetPurposeInputSchema = z.object({
  baseRevision: z.string(),
  purpose: z.literal("default"),
  model: ModelRefSchema,
});

export const TestKeySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set"), value: ApiKeyValueSchema }),
  z.object({ action: z.literal("keep"), endpointId: z.string().min(1) }),
  z.object({ action: z.literal("none") }),
]);

export const TestConnectionInputSchema = z.object({
  baseUrl: BaseUrlInputSchema,
  modelId: ModelIdSchema,
  key: TestKeySchema,
});

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
export type LlmConfigView = z.infer<typeof LlmConfigViewSchema>;
export type CreateEndpointInput = z.infer<typeof CreateEndpointInputSchema>;
export type CreateEndpointOutput = z.infer<typeof CreateEndpointOutputSchema>;
export type KeyChange = z.infer<typeof KeyChangeSchema>;
export type UpdateEndpointInput = z.infer<typeof UpdateEndpointInputSchema>;
export type SetPurposeInput = z.infer<typeof SetPurposeInputSchema>;
export type TestKey = z.infer<typeof TestKeySchema>;
export type TestConnectionInput = z.infer<typeof TestConnectionInputSchema>;
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;
