import type { ErrorCode } from '@unwritten/contracts';

export type Purpose = 'narrator' | 'author_chat' | 'background';

export interface LlmToolResult {
  text: string;
  terminate: boolean;
}

export interface LlmTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<LlmToolResult>;
}

export interface LlmRunRef {
  kind: 'turn_request' | 'job' | 'turn' | 'illustration' | 'portrait';
  id: string;
  attempt: number;
  workId: string | null;
}

export interface LlmRunInput {
  purpose: Purpose;
  system: string;
  prompt: string;
  tools: LlmTool[];
  requiredToolName: string;
  sessionId: string;
  ref: LlmRunRef;
  signal?: AbortSignal;
}

export interface LlmRunResult {
  requiredToolTerminated: boolean;
}

export interface ResolvedModel {
  endpointId: string;
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface LlmCompleteGuard {
  endpointId: string;
  modelId: string;
  assertCurrent(): void;
}

export interface LlmCompleteInput {
  purpose: Purpose;
  system: string;
  prompt: string;
  sessionId: string;
  ref: LlmRunRef;
  maxOutputTokens: number;
  signal?: AbortSignal;
  guard?: LlmCompleteGuard;
}

export interface LlmCompleteResult {
  text: string;
}

export class LlmRunError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | null;

  constructor(code: ErrorCode, detail: string | null) {
    super(code);
    this.name = 'LlmRunError';
    this.code = code;
    this.detail = detail;
  }
}
