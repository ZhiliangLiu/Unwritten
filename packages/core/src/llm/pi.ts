import { Agent } from '@earendil-works/pi-agent-core';
import { createModels, createProvider, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import packageJson from '../../package.json' with { type: 'json' };
import type { LlmTool } from './types.ts';

export interface RuntimeTarget {
  endpointId: string;
  endpointName: string;
  baseUrl: string;
  modelId: string;
  apiKey: string | undefined;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface Transport {
  fetch: typeof fetch;
  headers: Record<string, string>;
  sessionId: string;
  signal: AbortSignal;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
  costFromProvider: boolean;
}

export interface CompletionOutcome {
  stopReason: string;
  errorMessage: string | null;
  calledToolNames: string[];
  usage: UsageTotals;
}

const IDENTITY = {
  userAgent: { custom: `unwritten/${packageJson.version}` },
  attribution: null,
} as const;

const EMPTY_USAGE: UsageTotals = { input: 0, output: 0, cacheRead: 0, cost: 0, costFromProvider: false };

function build(target: RuntimeTarget): { models: ReturnType<typeof createModels>; model: Model<'openai-completions'> } {
  const model: Model<'openai-completions'> = {
    id: target.modelId,
    name: target.modelId,
    api: 'openai-completions',
    provider: target.endpointId,
    baseUrl: target.baseUrl,
    input: ['text'],
    reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: target.contextWindow,
    maxTokens: target.maxOutputTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      maxTokensField: 'max_tokens',
    },
  };
  const provider = createProvider({
    id: target.endpointId,
    name: target.endpointName,
    baseUrl: target.baseUrl,
    auth: {
      apiKey: {
        name: `${target.endpointName} API key`,
        resolve: async () => ({ auth: { apiKey: target.apiKey ?? 'unwritten-keyless' } }),
      },
    },
    models: [model],
    api: openAICompletionsApi(),
  });
  const models = createModels({ identity: IDENTITY });
  models.setProvider(provider);
  return { models, model };
}

function usageOf(message: AssistantMessage): UsageTotals {
  return {
    input: message.usage.input,
    output: message.usage.output,
    cacheRead: message.usage.cacheRead,
    cost: message.usage.cost.total,
    costFromProvider: message.usage.cost.totalFromProvider ?? false,
  };
}

function toolNamesOf(message: AssistantMessage): string[] {
  return message.content.filter((part) => part.type === 'toolCall').map((part) => part.name);
}

function outcomeOf(message: AssistantMessage): CompletionOutcome {
  return {
    stopReason: message.stopReason,
    errorMessage: message.errorMessage ?? null,
    calledToolNames: toolNamesOf(message),
    usage: usageOf(message),
  };
}

function addUsage(left: UsageTotals, right: UsageTotals): UsageTotals {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cost: left.cost + right.cost,
    costFromProvider: left.costFromProvider || right.costFromProvider,
  };
}

function toolsOf(tools: LlmTool[]) {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

export async function completeOnce(
  target: RuntimeTarget,
  transport: Transport,
  input: { system: string; user: string; tools: LlmTool[]; maxTokens: number },
): Promise<CompletionOutcome> {
  const { models, model } = build(target);
  const message = await models.complete(
    model,
    {
      systemPrompt: input.system,
      messages: [{ role: 'user', content: input.user, timestamp: Date.now() }],
      tools: toolsOf(input.tools),
    },
    {
      fetch: transport.fetch,
      headers: transport.headers,
      sessionId: transport.sessionId,
      signal: transport.signal,
      maxRetries: 0,
      maxTokens: input.maxTokens,
    },
  );
  return outcomeOf(message);
}

export interface AgentSession {
  prompt(text: string): Promise<CompletionOutcome>;
  abort(): void;
}

export function createAgentSession(
  target: RuntimeTarget,
  transport: Transport,
  input: { system: string; tools: LlmTool[]; onActivity(kind: 'output' | 'turn_end'): void },
): AgentSession {
  const { models, model } = build(target);
  const agentTools = input.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    label: tool.name,
    execute: async (_id: string, params: unknown) => {
      const result = await tool.execute((params ?? {}) as Record<string, unknown>);
      return { content: [{ type: 'text' as const, text: result.text }], details: {}, terminate: result.terminate };
    },
  }));
  const agent = new Agent({
    initialState: {
      systemPrompt: input.system,
      model,
      thinkingLevel: 'off',
      tools: agentTools,
      messages: [],
    },
    streamFn: (current, context, options) =>
      models.streamSimple(current, context, {
        ...options,
        fetch: transport.fetch,
        headers: { ...options?.headers, ...transport.headers },
        maxRetries: 0,
      }),
    sessionId: transport.sessionId,
    identity: IDENTITY,
    toolExecution: 'sequential',
  });
  agent.subscribe((event) => {
    if (event.type === 'message_update') input.onActivity('output');
    else if (event.type === 'turn_end') input.onActivity('turn_end');
  });

  const abort = () => agent.abort();
  if (transport.signal.aborted) abort();
  else transport.signal.addEventListener('abort', abort, { once: true });

  return {
    abort,
    async prompt(text) {
      const before = agent.state.messages.length;
      await agent.prompt(text);
      const messages = agent.state.messages.slice(before) as AssistantMessage[];
      const assistants = messages.filter((message) => message.role === 'assistant');
      const last = assistants.at(-1);
      if (!last) {
        return {
          stopReason: 'error',
          errorMessage: agent.state.errorMessage ?? 'assistant did not reply',
          calledToolNames: [],
          usage: EMPTY_USAGE,
        };
      }
      const usage = assistants.reduce((total, message) => addUsage(total, usageOf(message)), EMPTY_USAGE);
      return { ...outcomeOf(last), usage };
    },
  };
}
