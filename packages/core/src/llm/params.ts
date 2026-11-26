import type { GenerationParams, ThinkingFormat, ErrorCode } from '@unwritten/contracts';
import { EMPTY_GENERATION_PARAMS } from '@unwritten/contracts';
import type { ProvidersFile } from './providers-schema.ts';

export type FileParams = NonNullable<NonNullable<ProvidersFile['purposes']['default']>['params']>;

export function paramsFromFile(params: FileParams | undefined): GenerationParams {
  if (!params) return { ...EMPTY_GENERATION_PARAMS };
  return {
    thinking: params.thinking ?? null,
    thinkingBudget: params.thinkingBudget ?? null,
    temperature: params.temperature ?? null,
    topP: params.topP ?? null,
    topK: params.topK ?? null,
    minP: params.minP ?? null,
  };
}

export function paramsToFile(params: GenerationParams): FileParams | undefined {
  const file: FileParams = {};
  if (params.thinking !== null) file.thinking = params.thinking;
  if (params.thinkingBudget !== null) file.thinkingBudget = params.thinkingBudget;
  if (params.temperature !== null) file.temperature = params.temperature;
  if (params.topP !== null) file.topP = params.topP;
  if (params.topK !== null) file.topK = params.topK;
  if (params.minP !== null) file.minP = params.minP;
  return Object.keys(file).length === 0 ? undefined : file;
}

export function paramsProblem(
  params: GenerationParams,
  model: { reasoning: boolean | null; thinkingFormat: ThinkingFormat },
): ErrorCode | null {
  if (model.reasoning === false && params.thinking !== null && params.thinking !== 'off') {
    return 'thinking_unsupported';
  }
  if (
    params.thinkingBudget !== null &&
    (model.thinkingFormat !== 'qwen' || params.thinking === null || params.thinking === 'off')
  ) {
    return 'thinking_unsupported';
  }
  return null;
}

export function sanitizeParams(
  params: GenerationParams,
  model: { reasoning: boolean | null; thinkingFormat: ThinkingFormat },
): GenerationParams {
  const next = { ...params };
  if (model.reasoning === false && next.thinking !== null && next.thinking !== 'off') {
    next.thinking = null;
  }
  if (
    next.thinkingBudget !== null &&
    (model.thinkingFormat !== 'qwen' || next.thinking === null || next.thinking === 'off')
  ) {
    next.thinkingBudget = null;
  }
  return next;
}
