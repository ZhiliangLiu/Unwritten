import type { ErrorCode } from '@unwritten/contracts';

const SYSTEM_CODES = new Set(['EACCES', 'EADDRINUSE', 'EIO', 'ENOENT', 'ENOSPC', 'ENOTDIR', 'EPERM', 'EROFS']);

export function diagnosticFault(error: unknown): { errorType: string; systemCode?: string; sqliteCode?: number } {
  let fault = error;
  for (let depth = 0; fault instanceof Error && depth < 5; depth += 1) {
    const { code, errcode } = fault as Error & { code?: unknown; errcode?: unknown };
    if (code === 'ERR_SQLITE_ERROR' && typeof errcode === 'number' && Number.isSafeInteger(errcode)) {
      return { errorType: 'sqlite', sqliteCode: errcode };
    }
    if (typeof code === 'string' && SYSTEM_CODES.has(code)) return { errorType: 'system', systemCode: code };
    if (!(fault.cause instanceof Error)) break;
    fault = fault.cause;
  }
  const errorType =
    fault instanceof TypeError
      ? 'type'
      : fault instanceof RangeError
        ? 'range'
        : fault instanceof SyntaxError
          ? 'syntax'
          : fault instanceof Error
            ? 'error'
            : 'non_error';
  return { errorType };
}

export function storageError(fault: ReturnType<typeof diagnosticFault>): ErrorCode | undefined {
  const sqliteCode = (fault.sqliteCode ?? 0) & 0xff;
  if (sqliteCode === 13 || fault.systemCode === 'ENOSPC') return 'storage_full';
  if (sqliteCode === 5 || sqliteCode === 6) return 'storage_busy';
  if (sqliteCode === 8 || ['EACCES', 'EPERM', 'EROFS'].includes(fault.systemCode ?? '')) {
    return 'storage_unavailable';
  }
  return undefined;
}
