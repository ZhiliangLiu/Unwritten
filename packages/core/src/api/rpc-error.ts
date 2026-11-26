import { randomUUID } from 'node:crypto';
import { ValidationError } from '@orpc/contract';
import { ORPCError } from '@orpc/server';
import { ErrorCodeSchema, ErrorDataSchema, UuidSchema, type ErrorCode } from '@unwritten/contracts';
import { appError } from '../errors.ts';
import { diagnosticFault, storageError } from '../log/fault.ts';
import type { Logger } from '../log/logger.ts';

function inputError(procedure: string | undefined, validation: ValidationError | undefined): ErrorCode {
  for (const issue of validation?.issues ?? []) {
    if (!('code' in issue) || issue.code !== 'too_big') continue;
    if (procedure === 'works.saveBackground' && issue.path?.[0] === 'background') return 'background_too_long';
    if (procedure === 'play.submitAction' && issue.path?.[0] === 'action' && issue.path[1] === 'text') {
      return 'action_too_long';
    }
  }
  return 'invalid_input';
}

export function rpcError(logger: Logger, error: unknown, procedure?: string, input?: unknown) {
  const rpc = error instanceof ORPCError ? error : null;
  const known = ErrorCodeSchema.safeParse(rpc?.code).data;
  const data = ErrorDataSchema.safeParse(rpc?.data).data;
  if (rpc && known && data?.diagnosticId) return rpc;

  const validation = rpc?.cause instanceof ValidationError ? rpc.cause : undefined;
  if (rpc?.code === 'METHOD_NOT_SUPPORTED') return rpc;
  const badRequest = rpc?.code === 'BAD_REQUEST';
  const fault = known === 'save' || (!known && !badRequest && !validation) ? diagnosticFault(error) : undefined;
  const storage = fault && storageError(fault);
  const code = storage ?? known ?? (badRequest ? inputError(procedure, validation) : 'internal');
  const failure = appError(code, known && rpc ? rpc.message : code, data?.detail ?? null);
  const diagnosticId = randomUUID();
  const stage = validation ? (badRequest ? 'input' : 'output') : procedure ? 'operation' : 'transport';

  const ids = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  logger.record({
    id: diagnosticId,
    level: failure.status >= 500 ? 'error' : 'warn',
    module: 'api',
    event: 'rpc.failed',
    workId: UuidSchema.safeParse(ids.workId).data,
    jobId: UuidSchema.safeParse(ids.jobId).data,
    requestId: UuidSchema.safeParse(ids.requestId).data,
    data: {
      code,
      stage,
      ...(procedure && { procedure }),
      ...(validation && { issueCount: validation.issues.length }),
      ...fault,
    },
  });
  failure.data.diagnosticId = diagnosticId;
  return failure;
}
