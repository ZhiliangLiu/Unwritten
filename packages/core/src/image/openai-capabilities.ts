import { OPENAI_IMAGE_DEFAULTS } from '@unwritten/contracts';
import type {
  ImageCapabilities,
  ImageSize,
  ImageTierPreference,
  OpenAiImageCompat,
  OpenAiImageOptions,
  OpenAiSizeMode,
} from '@unwritten/contracts';

const FIXED_SIZES: Record<string, Record<string, ImageSize>> = {
  '1:1': { '1k': { width: 1024, height: 1024 } },
  '3:2': { '1k': { width: 1536, height: 1024 } },
  '2:3': { '1k': { width: 1024, height: 1536 } },
};

const CUSTOM_SIZES: Record<string, Record<string, ImageSize>> = {
  '1:1': {
    '1k': { width: 1024, height: 1024 },
    '2k': { width: 2048, height: 2048 },
  },
  '3:2': {
    '720': { width: 1088, height: 720 },
    '1k': { width: 1536, height: 1024 },
    '2k': { width: 3072, height: 2048 },
  },
  '2:3': {
    '720': { width: 720, height: 1088 },
    '1k': { width: 1024, height: 1536 },
    '2k': { width: 2048, height: 3072 },
  },
  '3:4': {
    '720': { width: 720, height: 960 },
    '1k': { width: 1024, height: 1360 },
    '2k': { width: 2048, height: 2736 },
  },
  '4:3': {
    '720': { width: 960, height: 720 },
    '1k': { width: 1360, height: 1024 },
    '2k': { width: 2736, height: 2048 },
  },
  '16:9': {
    '720': { width: 1280, height: 720 },
    '1k': { width: 1824, height: 1024 },
    '2k': { width: 3648, height: 2048 },
  },
  '9:16': {
    '720': { width: 720, height: 1280 },
    '1k': { width: 1024, height: 1824 },
    '2k': { width: 2048, height: 3648 },
  },
};

const OPENAI_SIZES: Record<OpenAiSizeMode, Record<string, Record<string, ImageSize>>> = {
  fixed: FIXED_SIZES,
  custom: CUSTOM_SIZES,
};

const GPT_IMAGE_2_PREFIX = 'gpt-image-2';
const FIXED_REFERENCE_MODELS = new Set(['gpt-image-1.5', 'gpt-image-1-mini', 'chatgpt-image-latest']);

export type ResolvedOpenAiImageOptions = OpenAiImageOptions & OpenAiImageCompat;

export function prefillOpenAiOptions(modelId: string): ResolvedOpenAiImageOptions {
  if (modelId.startsWith(GPT_IMAGE_2_PREFIX)) {
    return { ...OPENAI_IMAGE_DEFAULTS, maxReferences: 16, sizes: 'custom' };
  }
  if (FIXED_REFERENCE_MODELS.has(modelId)) {
    return { ...OPENAI_IMAGE_DEFAULTS, maxReferences: 16, sizes: 'fixed' };
  }
  return { ...OPENAI_IMAGE_DEFAULTS, maxReferences: 0, sizes: 'fixed' };
}

export function resolveOpenAiOptions(
  options: OpenAiImageOptions | undefined,
  model: string,
): ResolvedOpenAiImageOptions {
  const base = options ?? prefillOpenAiOptions(model);
  return {
    ...base,
    outputFormat: base.outputFormat ?? OPENAI_IMAGE_DEFAULTS.outputFormat,
    responseFormat: base.responseFormat ?? OPENAI_IMAGE_DEFAULTS.responseFormat,
    referenceTransport: base.referenceTransport ?? OPENAI_IMAGE_DEFAULTS.referenceTransport,
    disableWatermark: base.disableWatermark ?? OPENAI_IMAGE_DEFAULTS.disableWatermark,
  };
}

export function openAiCapabilities(options: { maxReferences: number; sizes: OpenAiSizeMode }): ImageCapabilities {
  const sizes = OPENAI_SIZES[options.sizes];
  return {
    maxReferences: options.maxReferences,
    maxReferenceBytes: null,
    maxPromptLength: null,
    seed: false,
    negativePrompt: false,
    qualities: ['fast', 'best'],
    aspects: Object.keys(sizes),
    resolutions: sizes,
  };
}

export function openAiSizeFor(sizes: OpenAiSizeMode, aspect: string, tier: ImageTierPreference): ImageSize | null {
  return OPENAI_SIZES[sizes][aspect]?.[tier === 'default' ? '1k' : tier] ?? null;
}
