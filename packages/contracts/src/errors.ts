import { z } from 'zod';

export const ERROR_CODES = [
  'invalid_input',
  'internal',
  'not_found',
  'stale_revision',
  'stale_preview',
  'already_published',
  'job_running',
  'preview_not_ready',
  'stale_head',
  'request_in_progress',
  'idempotency_conflict',
  'option_mismatch',
  'request_not_retryable',
  'llm_not_configured',
  'llm_config_invalid',
  'llm_config_too_new',
  'config_conflict',
  'endpoint_not_found',
  'invalid_url',
  'unauthorized',
  'quota',
  'rate_limited',
  'context_overflow',
  'context_too_small',
  'network',
  'unreachable',
  'timeout',
  'server',
  'redirected',
  'not_compatible',
  'no_tool_call',
  'invalid_output',
  'interrupted',
  'save',
  'thinking_unsupported',
  'last_model',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorDataSchema = z.object({ detail: z.string().nullable() });
export type ErrorData = z.infer<typeof ErrorDataSchema>;
