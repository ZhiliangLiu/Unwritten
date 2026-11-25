import type { ErrorCode } from '@unwritten/contracts';
import type { LlmRunInput, LlmRunResult, ResolvedModel } from '../llm/types.ts';
import { LlmRunError } from '../llm/types.ts';
import type { LlmService } from '../services.ts';

export type ScriptStep = { args: Record<string, string> } | { fail: ErrorCode; detail?: string };

export interface ScriptedLlm extends LlmService {
  runs: LlmRunInput[];
  enqueue(...steps: ScriptStep[]): void;
  setResolved(model: ResolvedModel | null): void;
}

const DEFAULT_MODEL: ResolvedModel = {
  endpointId: 'custom-test-000000',
  modelId: 'test-model',
  contextWindow: 32768,
  maxOutputTokens: 8192,
};

export function createScriptedLlm(options?: { resolved?: ResolvedModel | null }): ScriptedLlm {
  const steps: ScriptStep[] = [];
  const runs: LlmRunInput[] = [];
  let resolved = options?.resolved === undefined ? DEFAULT_MODEL : options.resolved;

  const notScripted = (): never => {
    throw new Error('not scripted');
  };

  return {
    runs,
    enqueue(...next) {
      steps.push(...next);
    },
    setResolved(model) {
      resolved = model;
    },
    resolve() {
      return resolved;
    },
    estimateTokens(text) {
      return Math.ceil(text.length * 2);
    },
    async run(input): Promise<LlmRunResult> {
      runs.push(input);
      const tool = input.tools.find((candidate) => candidate.name === input.requiredToolName);
      while (steps.length) {
        const step = steps.shift();
        if (!step) break;
        if ('fail' in step) throw new LlmRunError(step.fail, step.detail ?? null);
        if (!tool) throw new LlmRunError('invalid_output', null);
        try {
          const result = await tool.execute(step.args);
          if (result.terminate) return { requiredToolTerminated: true };
        } catch {
          continue;
        }
      }
      throw new LlmRunError('invalid_output', null);
    },
    listProviders: notScripted,
    createEndpoint: notScripted,
    updateEndpoint: notScripted,
    setPurpose: notScripted,
    testConnection: notScripted,
    pruneCalls: notScripted,
  };
}
