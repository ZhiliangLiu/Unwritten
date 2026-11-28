import type { ErrorCode } from '@unwritten/contracts';

export type ImageErrorKind = 'final' | 'capability' | 'format' | 'busy' | 'transport';

export class ImageError extends Error {
  readonly code: ErrorCode;
  readonly kind: ImageErrorKind;
  readonly retryAfterMs: number | null;
  readonly submitted: boolean;

  constructor(
    code: ErrorCode,
    kind: ImageErrorKind,
    options?: { retryAfterMs?: number; submitted?: boolean; cause?: unknown },
  ) {
    super(code, { cause: options?.cause });
    this.name = 'ImageError';
    this.code = code;
    this.kind = kind;
    this.retryAfterMs = options?.retryAfterMs ?? null;
    this.submitted = options?.submitted ?? false;
  }
}
