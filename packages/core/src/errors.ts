import { ORPCError } from '@orpc/server';
import type { ErrorCode, ErrorData } from '@unwritten/contracts';

const HTTP_STATUS: Record<ErrorCode, number> = {
  invalid_input: 400,
  internal: 500,
  not_found: 404,
  stale_revision: 409,
  stale_preview: 409,
  already_published: 409,
  job_running: 409,
  preview_not_ready: 409,
  stale_head: 409,
  request_in_progress: 409,
  idempotency_conflict: 409,
  option_mismatch: 409,
  request_not_retryable: 409,
  llm_not_configured: 409,
  llm_config_invalid: 409,
  llm_config_too_new: 409,
  config_conflict: 409,
  endpoint_not_found: 404,
  invalid_url: 400,
  unauthorized: 502,
  quota: 502,
  rate_limited: 502,
  context_overflow: 502,
  context_too_small: 409,
  network: 502,
  unreachable: 502,
  timeout: 504,
  server: 502,
  redirected: 502,
  not_compatible: 502,
  no_tool_call: 502,
  invalid_output: 502,
  interrupted: 409,
  save: 500,
};

export function appError(code: ErrorCode, message: string, detail: string | null = null) {
  const data: ErrorData = { detail };
  return new ORPCError(code, { status: HTTP_STATUS[code], message, data });
}
