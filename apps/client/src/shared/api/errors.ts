import { ORPCError } from '@orpc/client';
import { UuidSchema } from '@unwritten/contracts';

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

export function errorDiagnosticId(error: unknown): string | undefined {
  if (!(error instanceof ORPCError) || typeof error.data !== 'object' || error.data === null) return undefined;
  return UuidSchema.safeParse((error.data as { diagnosticId?: unknown }).diagnosticId).data;
}
