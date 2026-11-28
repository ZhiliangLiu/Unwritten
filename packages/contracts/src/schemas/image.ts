import { z } from 'zod';
import { ErrorCodeSchema } from '../errors.ts';
import { TimestampSchema, UuidSchema } from './common.ts';
import { ConfigProblemSchema, KeyChangeSchema, KeyStatusSchema } from './llm.ts';

export const IMAGE_PROTOCOLS = ['unwritten-image', 'openai-images'] as const;
export const ImageProtocolSchema = z.enum(IMAGE_PROTOCOLS);

export const IMAGE_TIERS = ['720', '1k', '2k'] as const;
export const ImageTierSchema = z.enum(IMAGE_TIERS);
export const IMAGE_TIER_PREFERENCES = ['720', '1k', '2k', 'default'] as const;
export const ImageTierPreferenceSchema = z.enum(IMAGE_TIER_PREFERENCES);

export const IMAGE_QUALITIES = ['fast', 'best'] as const;
export const ImageQualitySchema = z.enum(IMAGE_QUALITIES);

export const AspectSchema = z.string().regex(/^[1-9]\d{0,2}:[1-9]\d{0,2}$/u);
export const AspectPreferenceSchema = z.union([z.literal('auto'), AspectSchema]);

export const ImageSizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_MAX_PIXELS = 32_000_000;
export const PORTRAIT_IMPORT_MAX_EDGE = 1536;
export const PORTRAIT_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
export const PORTRAIT_UPLOAD_MAX_BODY_BYTES = PORTRAIT_IMPORT_MAX_BYTES + 64 * 1024;

export const ImageCapabilitiesSchema = z.object({
  maxReferences: z.number().int().nonnegative(),
  maxReferenceBytes: z.number().int().positive().nullable(),
  maxPromptLength: z.number().int().positive().nullable(),
  seed: z.boolean(),
  negativePrompt: z.boolean(),
  qualities: z.array(ImageQualitySchema).min(1),
  aspects: z.array(AspectSchema).min(1),
  resolutions: z.record(z.string(), z.record(z.string(), ImageSizeSchema)),
});

export const OPENAI_SIZE_MODES = ['fixed', 'custom'] as const;
export const OpenAiImageOptionsSchema = z.object({
  maxReferences: z.number().int().min(0).max(16),
  sizes: z.enum(OPENAI_SIZE_MODES),
});

export const IMAGE_SERVICE_STATES = ['ready', 'offline', 'waking', 'needs_action', 'wake_failed', 'unknown'] as const;
export const ImageServiceStateSchema = z.enum(IMAGE_SERVICE_STATES);

export const LAUNCHER_STATES = ['stopped', 'starting', 'needs_action', 'running', 'stopping', 'failed'] as const;
export const LauncherStateSchema = z.enum(LAUNCHER_STATES);
export const LAUNCHER_FAILURE_REASONS = ['quota', 'not_signed_in', 'action_expired', 'start_error'] as const;
export const LauncherFailureReasonSchema = z.enum(LAUNCHER_FAILURE_REASONS);

export const IDLE_MINUTES_MIN = 5;
export const IDLE_MINUTES_MAX = 720;
export const IMAGE_IDLE_MINUTES = 30;
export const IdleMinutesSchema = z.number().int().min(IDLE_MINUTES_MIN).max(IDLE_MINUTES_MAX);

export const PROBE_RESULTS = ['ready', 'not_ready', 'offline', 'unauthorized', 'invalid'] as const;
export type ProbeResult = (typeof PROBE_RESULTS)[number];

const ImplementationSchema = z.object({ name: z.string(), version: z.string() });

export const ImageServiceViewSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  protocol: ImageProtocolSchema,
  baseUrl: z.string(),
  key: KeyStatusSchema,
  model: z.string().nullable(),
  openai: OpenAiImageOptionsSchema.nullable(),
  launcher: z.object({ baseUrl: z.string(), key: KeyStatusSchema }).nullable(),
  idleMinutes: IdleMinutesSchema,
  capabilities: ImageCapabilitiesSchema.nullable(),
  probe: z
    .object({
      at: TimestampSchema,
      result: z.enum(PROBE_RESULTS),
      notReadyReason: z.string().nullable(),
      implementation: ImplementationSchema.nullable(),
      model: z.string().nullable(),
    })
    .nullable(),
  lastSuccessAt: TimestampSchema.nullable(),
  state: ImageServiceStateSchema,
  action: z.object({ url: z.string(), expiresAt: TimestampSchema }).nullable(),
  wakeFailure: z.object({ code: ErrorCodeSchema, reason: LauncherFailureReasonSchema.nullable() }).nullable(),
});

export const ImageConfigViewSchema = z.object({
  status: z.enum(['ok', 'missing', 'invalid', 'too_new']),
  revision: z.string(),
  problem: ConfigProblemSchema.nullable(),
  services: z.array(ImageServiceViewSchema),
  selectedServiceId: z.string().nullable(),
});

const ServiceNameSchema = z.string().trim().min(1).max(60);
const BaseUrlInputSchema = z.string().trim().min(1).max(2048);
const ApiKeyValueSchema = z.string().trim().min(1).max(4096);
const ModelIdSchema = z.string().trim().min(1).max(200);

export const CreateImageServiceInputSchema = z.object({
  requestId: UuidSchema,
  baseRevision: z.string(),
  name: ServiceNameSchema,
  protocol: ImageProtocolSchema,
  baseUrl: BaseUrlInputSchema,
  apiKey: ApiKeyValueSchema.nullable(),
  model: ModelIdSchema.nullable(),
  openai: OpenAiImageOptionsSchema.nullable(),
  launcher: z.object({ baseUrl: BaseUrlInputSchema, apiKey: ApiKeyValueSchema.nullable() }).nullable(),
  idleMinutes: IdleMinutesSchema.nullable(),
});
export const CreateImageServiceOutputSchema = z.object({ serviceId: z.string(), config: ImageConfigViewSchema });

export const LauncherChangeSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('keep'), key: KeyChangeSchema }),
  z.object({ action: z.literal('set'), baseUrl: BaseUrlInputSchema, apiKey: ApiKeyValueSchema.nullable() }),
  z.object({ action: z.literal('remove') }),
]);

export const UpdateImageServiceInputSchema = z.object({
  baseRevision: z.string(),
  serviceId: z.string().min(1),
  name: ServiceNameSchema,
  key: KeyChangeSchema,
  model: ModelIdSchema.nullable(),
  openai: OpenAiImageOptionsSchema.nullable(),
  launcher: LauncherChangeSchema,
  idleMinutes: IdleMinutesSchema,
});

export const RemoveImageServiceInputSchema = z.object({ baseRevision: z.string(), serviceId: z.string().min(1) });
export const SelectImageServiceInputSchema = z.object({
  baseRevision: z.string(),
  serviceId: z.string().min(1).nullable(),
});
export const GeneratedTokenSchema = z.object({ token: z.string().min(43) });

export const TestImageServiceInputSchema = z.object({
  serviceId: z.string().min(1),
  target: z.enum(['service', 'launcher']),
  paid: z.boolean().default(false),
});
export const TestImageServiceResultSchema = z.object({
  ok: z.boolean(),
  code: ErrorCodeSchema.nullable(),
  service: z
    .object({
      implementation: ImplementationSchema.nullable(),
      model: z.string().nullable(),
      ready: z.boolean(),
      notReadyReason: z.string().nullable(),
      capabilities: ImageCapabilitiesSchema.nullable(),
    })
    .nullable(),
  launcher: z
    .object({
      implementation: ImplementationSchema,
      ready: z.boolean(),
      notReadyReason: z.string().nullable(),
      state: LauncherStateSchema,
    })
    .nullable(),
  generated: ImageSizeSchema.nullable(),
});

export const OutputPreferencesSchema = z.object({
  aspectPreference: AspectPreferenceSchema,
  resolutionTier: ImageTierPreferenceSchema,
});
export const DEFAULT_OUTPUT_PREFERENCES = { aspectPreference: 'auto', resolutionTier: '1k' } as const;
export const OutputOptionsViewSchema = z.object({
  preferences: OutputPreferencesSchema,
  aspects: z.array(AspectSchema),
  tiers: z.array(z.object({ tier: ImageTierPreferenceSchema, sizes: z.record(z.string(), ImageSizeSchema) })),
  preferenceAvailable: z.boolean(),
});

export const AutoIllustrationTargetSchema = z.object({
  serviceId: z.string().min(1),
  model: z.string().nullable(),
  background: z.object({ endpointId: z.string().min(1), modelId: z.string().min(1) }),
});
export const AutoIllustrationViewSchema = z.object({
  enabled: z.boolean(),
  current: AutoIllustrationTargetSchema.nullable(),
  confirmed: AutoIllustrationTargetSchema.nullable(),
});
export const SetAutoIllustrationInputSchema = z.object({
  enabled: z.boolean(),
  confirm: AutoIllustrationTargetSchema.nullable(),
});

const UsageWindowSchema = z.object({
  images: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export const ImageUsageSummarySchema = z.object({
  services: z.array(
    z.object({
      serviceId: z.string(),
      name: z.string().nullable(),
      last7Days: UsageWindowSchema,
      last30Days: UsageWindowSchema,
    }),
  ),
});
export const ImageStorageSummarySchema = z.object({
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});

export const PrewarmInputSchema = z.object({ playthroughId: UuidSchema });
export const ContinueWakeInputSchema = z.object({ serviceId: z.string().min(1), requestId: UuidSchema });

export type ImageProtocol = (typeof IMAGE_PROTOCOLS)[number];
export type ImageTier = (typeof IMAGE_TIERS)[number];
export type ImageTierPreference = (typeof IMAGE_TIER_PREFERENCES)[number];
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export type Aspect = z.infer<typeof AspectSchema>;
export type AspectPreference = z.infer<typeof AspectPreferenceSchema>;
export type ImageSize = z.infer<typeof ImageSizeSchema>;
export type ImageCapabilities = z.infer<typeof ImageCapabilitiesSchema>;
export type OpenAiSizeMode = (typeof OPENAI_SIZE_MODES)[number];
export type OpenAiImageOptions = z.infer<typeof OpenAiImageOptionsSchema>;
export type ImageServiceState = (typeof IMAGE_SERVICE_STATES)[number];
export type LauncherState = (typeof LAUNCHER_STATES)[number];
export type LauncherFailureReason = (typeof LAUNCHER_FAILURE_REASONS)[number];
export type IdleMinutes = z.infer<typeof IdleMinutesSchema>;
export type ImageServiceView = z.infer<typeof ImageServiceViewSchema>;
export type ImageConfigView = z.infer<typeof ImageConfigViewSchema>;
export type CreateImageServiceInput = z.infer<typeof CreateImageServiceInputSchema>;
export type CreateImageServiceOutput = z.infer<typeof CreateImageServiceOutputSchema>;
export type LauncherChange = z.infer<typeof LauncherChangeSchema>;
export type UpdateImageServiceInput = z.infer<typeof UpdateImageServiceInputSchema>;
export type RemoveImageServiceInput = z.infer<typeof RemoveImageServiceInputSchema>;
export type SelectImageServiceInput = z.infer<typeof SelectImageServiceInputSchema>;
export type GeneratedToken = z.infer<typeof GeneratedTokenSchema>;
export type TestImageServiceInput = z.infer<typeof TestImageServiceInputSchema>;
export type TestImageServiceResult = z.infer<typeof TestImageServiceResultSchema>;
export type OutputPreferences = z.infer<typeof OutputPreferencesSchema>;
export type OutputOptionsView = z.infer<typeof OutputOptionsViewSchema>;
export type AutoIllustrationTarget = z.infer<typeof AutoIllustrationTargetSchema>;
export type AutoIllustrationView = z.infer<typeof AutoIllustrationViewSchema>;
export type SetAutoIllustrationInput = z.infer<typeof SetAutoIllustrationInputSchema>;
export type ImageUsageSummary = z.infer<typeof ImageUsageSummarySchema>;
export type ImageStorageSummary = z.infer<typeof ImageStorageSummarySchema>;
export type PrewarmInput = z.infer<typeof PrewarmInputSchema>;
export type ContinueWakeInput = z.infer<typeof ContinueWakeInputSchema>;
