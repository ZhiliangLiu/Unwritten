import type { ErrorCode } from '@unwritten/contracts';

export interface FailureEvidence {
  httpStatus: number | null;
  redirected: boolean;
  timedOut: boolean;
  aborted: boolean;
  errorMessage: string;
}

const CONTEXT_MESSAGE = /context|too long|maximum.*tokens|token limit|prompt is too long/i;
const QUOTA_MESSAGE = /quota|insufficient|exceeded|billing|usage limit|limit reached/i;

export function classifyFailure(evidence: FailureEvidence): ErrorCode {
  const message = evidence.errorMessage;
  if (evidence.redirected) return 'redirected';
  if (evidence.timedOut) return 'timeout';
  if (evidence.aborted) return 'interrupted';
  if (evidence.httpStatus === 401 || evidence.httpStatus === 403) return 'unauthorized';
  if (evidence.httpStatus === 429) return QUOTA_MESSAGE.test(message) ? 'quota' : 'rate_limited';
  if (evidence.httpStatus !== null && [400, 413, 422].includes(evidence.httpStatus) && CONTEXT_MESSAGE.test(message)) {
    return 'context_overflow';
  }
  if (evidence.httpStatus === 404) return 'not_compatible';
  if (evidence.httpStatus !== null && evidence.httpStatus >= 500) return 'server';
  if (
    (evidence.httpStatus === null || (evidence.httpStatus >= 200 && evidence.httpStatus < 300)) &&
    /timeout|timed out/i.test(message)
  ) {
    return 'timeout';
  }
  if (evidence.httpStatus === null || (evidence.httpStatus >= 200 && evidence.httpStatus < 300)) return 'network';
  return 'server';
}
