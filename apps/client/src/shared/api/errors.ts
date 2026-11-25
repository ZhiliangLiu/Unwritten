import { ORPCError } from '@orpc/client';

export function errorCode(error: unknown): string {
  if (error instanceof ORPCError) return error.code;
  return 'unknown';
}

export function errorDetail(error: unknown): string | null {
  if (error instanceof ORPCError) {
    const data = error.data as { detail?: unknown } | undefined;
    return typeof data?.detail === 'string' ? data.detail : null;
  }
  return null;
}
