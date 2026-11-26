import type { GenerationParams, ThinkingFormat, ThinkingLevel } from '@unwritten/contracts';

export interface ParamsFormState {
  thinking: ThinkingLevel | 'unset';
  thinkingBudget: number | null;
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  minP: number | null;
}

export function formFromParams(params: GenerationParams): ParamsFormState {
  return {
    thinking: params.thinking ?? 'unset',
    thinkingBudget: params.thinkingBudget,
    temperature: params.temperature,
    topP: params.topP,
    topK: params.topK,
    minP: params.minP,
  };
}

export function paramsFromForm(form: ParamsFormState): GenerationParams {
  return {
    thinking: form.thinking === 'unset' ? null : form.thinking,
    thinkingBudget: form.thinkingBudget,
    temperature: form.temperature,
    topP: form.topP,
    topK: form.topK,
    minP: form.minP,
  };
}

export function fieldAvailability(
  form: ParamsFormState,
  model: { reasoning: boolean | null; thinkingFormat: ThinkingFormat } | null,
): {
  thinking: { enabled: boolean; reasonKey: string | null };
  thinkingBudget: { enabled: boolean; reasonKey: string | null };
  samplingWarningKey: string | null;
} {
  const thinkingEnabled = model !== null && model.reasoning !== false;
  const thinkingReasonKey =
    model === null
      ? 'settings:params.reason.noModel'
      : model.reasoning === false
        ? 'settings:params.reason.noReasoning'
        : null;

  const thinkingBudgetEnabled =
    model !== null && model.thinkingFormat === 'qwen' && form.thinking !== 'unset' && form.thinking !== 'off';
  const thinkingBudgetReasonKey = thinkingBudgetEnabled
    ? null
    : model === null || model.thinkingFormat !== 'qwen'
      ? 'settings:params.reason.budgetFormat'
      : 'settings:params.reason.budgetNeedsThinking';

  const thinkingActive = form.thinking !== 'unset' && form.thinking !== 'off';
  const hasSamplingParam = form.temperature !== null || form.topP !== null || form.topK !== null || form.minP !== null;

  return {
    thinking: { enabled: thinkingEnabled, reasonKey: thinkingReasonKey },
    thinkingBudget: { enabled: thinkingBudgetEnabled, reasonKey: thinkingBudgetReasonKey },
    samplingWarningKey: thinkingActive && hasSamplingParam ? 'settings:params.samplingWarning' : null,
  };
}
