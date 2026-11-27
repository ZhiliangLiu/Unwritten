import { Agent } from '@earendil-works/pi-agent-core';
import { createModels, createProvider, type AssistantMessage, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { GenerationParams, LlmLogContent, ThinkingFormat } from '@unwritten/contracts';
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
  thinkingFormat: ThinkingFormat;
  params: GenerationParams;
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
  text: string;
  content: LlmLogContent[];
}

const IDENTITY = {
  userAgent: { custom: `unwritten/${packageJson.version}` },
  attribution: null,
} as const;

const EMPTY_USAGE: UsageTotals = { input: 0, output: 0, cacheRead: 0, cost: 0, costFromProvider: false };

type OpenAiCompat = NonNullable<Model<'openai-completions'>['compat']>;

function thinkingCompat(format: ThinkingFormat): Partial<OpenAiCompat> {
  if (format === 'auto') return {};
  if (format === 'openai') return { thinkingFormat: 'openai', supportsReasoningEffort: true };
  if (format === 'qwen') {
    return { thinkingFormat: 'qwen', supportsReasoningEffort: false, thinkingTokenBudgetField: 'thinking_budget' };
  }
  if (format === 'qwen-chat-template') {
    return { thinkingFormat: 'qwen-chat-template', supportsReasoningEffort: false };
  }
  if (format === 'deepseek') return { thinkingFormat: 'deepseek', supportsReasoningEffort: false };
  if (format === 'openrouter') return { thinkingFormat: 'openrouter' };
  return { thinkingFormat: 'zai', supportsReasoningEffort: false };
}

type ReasoningLevel = Exclude<GenerationParams['thinking'], null | 'off'>;

interface RequestOptions {
  reasoning?: ReasoningLevel;
  thinkingBudgets?: { minimal: number; low: number; medium: number; high: number };
  temperature?: number;
  samplingParams?: Record<string, number>;
}

function requestOptions(params: GenerationParams): RequestOptions {
  const options: RequestOptions = {};
  if (params.thinking !== null && params.thinking !== 'off') options.reasoning = params.thinking;
  if (params.thinkingBudget !== null) {
    options.thinkingBudgets = {
      minimal: params.thinkingBudget,
      low: params.thinkingBudget,
      medium: params.thinkingBudget,
      high: params.thinkingBudget,
    };
  }
  if (params.temperature !== null) options.temperature = params.temperature;
  const samplingParams: Record<string, number> = {};
  if (params.topP !== null) samplingParams.top_p = params.topP;
  if (params.topK !== null) samplingParams.top_k = params.topK;
  if (params.minP !== null) samplingParams.min_p = params.minP;
  if (Object.keys(samplingParams).length > 0) options.samplingParams = samplingParams;
  return options;
}

function build(target: RuntimeTarget): { models: ReturnType<typeof createModels>; model: Model<'openai-completions'> } {
  const thinkingSet = target.params.thinking !== null;
  const model: Model<'openai-completions'> = {
    id: target.modelId,
    name: target.modelId,
    api: 'openai-completions',
    provider: target.endpointId,
    baseUrl: target.baseUrl,
    input: ['text'],
    reasoning: thinkingSet,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: target.contextWindow,
    maxTokens: target.maxOutputTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      ...thinkingCompat(target.thinkingFormat),
    },
  };
  if (thinkingSet) model.thinkingLevelMap = { off: 'none', xhigh: 'xhigh', max: 'max' };
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

function contentOf(message: AssistantMessage): LlmLogContent[] {
  return message.content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'thinking') return { type: 'thinking', thinking: part.thinking };
    return {
      type: 'toolCall',
      id: part.id,
      name: part.name,
      arguments: part.arguments,
      ...(part.argumentsError === undefined ? {} : { argumentsError: part.argumentsError }),
    };
  });
}

function outcomeOf(message: AssistantMessage): CompletionOutcome {
  return {
    stopReason: message.stopReason,
    errorMessage: message.errorMessage ?? null,
    calledToolNames: toolNamesOf(message),
    usage: usageOf(message),
    text: message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
    content: contentOf(message),
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
  input: { system: string; user: string; tools: LlmTool[]; maxTokens: number; onOutput?: () => void },
): Promise<CompletionOutcome> {
  const { models, model } = build(target);
  const stream = models.streamSimple(
    model,
    {
      systemPrompt: input.system,
      messages: [{ role: 'user', content: input.user, timestamp: Date.now() }],
      tools: toolsOf(input.tools),
    },
    {
      ...requestOptions(target.params),
      fetch: transport.fetch,
      headers: transport.headers,
      sessionId: transport.sessionId,
      signal: transport.signal,
      maxRetries: 0,
      maxTokens: input.maxTokens,
    },
  );
  for await (const event of stream) {
    if (event.type.endsWith('_delta')) input.onOutput?.();
  }
  return outcomeOf(await stream.result());
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
      thinkingLevel: target.params.thinking ?? 'off',
      tools: agentTools,
      messages: [],
    },
    streamFn: (current, context, options) =>
      models.streamSimple(current, context, {
        ...options,
        ...requestOptions(target.params),
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
          text: '',
          content: [],
        };
      }
      const usage = assistants.reduce((total, message) => addUsage(total, usageOf(message)), EMPTY_USAGE);
      return { ...outcomeOf(last), usage };
    },
  };
}
