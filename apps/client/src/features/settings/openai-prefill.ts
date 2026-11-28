import { OPENAI_IMAGE_DEFAULTS } from '@unwritten/contracts';
import type { OpenAiImageCompat, OpenAiSizeMode } from '@unwritten/contracts';

export type OpenAiPrefill = { maxReferences: number; sizes: OpenAiSizeMode } & OpenAiImageCompat;

export const OPENAI_REFERENCE_LIMIT = 16;

const GPT_IMAGE_2_PREFIX = 'gpt-image-2';
const FIXED_REFERENCE_MODELS = new Set(['gpt-image-1.5', 'gpt-image-1-mini', 'chatgpt-image-latest']);

export function prefillOpenAiOptions(modelId: string): OpenAiPrefill {
  if (modelId.startsWith(GPT_IMAGE_2_PREFIX)) {
    return { ...OPENAI_IMAGE_DEFAULTS, maxReferences: OPENAI_REFERENCE_LIMIT, sizes: 'custom' };
  }
  if (FIXED_REFERENCE_MODELS.has(modelId)) {
    return { ...OPENAI_IMAGE_DEFAULTS, maxReferences: OPENAI_REFERENCE_LIMIT, sizes: 'fixed' };
  }
  return { ...OPENAI_IMAGE_DEFAULTS, maxReferences: 0, sizes: 'fixed' };
}
