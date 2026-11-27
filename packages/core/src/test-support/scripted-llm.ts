import type { ErrorCode } from '@unwritten/contracts';
import type { LlmCompleteInput, LlmCompleteResult, LlmRunInput, LlmRunResult, ResolvedModel } from '../llm/types.ts';
import { LlmRunError } from '../llm/types.ts';
import type { LlmService } from '../services.ts';

export type ScriptStep =
  | { args: Record<string, string> }
  | { tool: string; args: Record<string, string> }
  | { text: string }
  | { fail: ErrorCode; detail?: string };

export interface ScriptedLlm extends LlmService {
  runs: LlmRunInput[];
  completes: LlmCompleteInput[];
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
  const completes: LlmCompleteInput[] = [];
  let resolved = options?.resolved === undefined ? DEFAULT_MODEL : options.resolved;

  const notScripted = (): never => {
    throw new Error('not scripted');
  };

  return {
    runs,
    completes,
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
        if ('text' in step) throw new LlmRunError('invalid_output', null);
        if ('tool' in step) {
          const selected = input.tools.find((candidate) => candidate.name === step.tool);
          if (!selected) continue;
          await selected.execute(step.args);
          continue;
        }
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
    async complete(input): Promise<LlmCompleteResult> {
      completes.push(input);
      const step = steps.shift();
      if (!step) throw new LlmRunError('invalid_output', null);
      if ('fail' in step) throw new LlmRunError(step.fail, step.detail ?? null);
      if ('text' in step) return { text: step.text };
      throw new LlmRunError('invalid_output', null);
    },
    listProviders: notScripted,
    createEndpoint: notScripted,
    updateEndpoint: notScripted,
    removeEndpoint: notScripted,
    addModel: notScripted,
    updateModel: notScripted,
    removeModel: notScripted,
    setPurpose: notScripted,
    testConnection: notScripted,
    listLogs: () => ({ items: [] }),
    getLog: notScripted,
    pruneCalls: notScripted,
  };
}
