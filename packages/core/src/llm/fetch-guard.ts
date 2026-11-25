export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class RedirectBlockedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`redirect blocked: ${status}`);
    this.name = 'RedirectBlockedError';
    this.status = status;
  }
}

export interface FetchRecorder {
  lastStatus: number | null;
  redirected: boolean;
}

export function createFetchRecorder(): FetchRecorder {
  return { lastStatus: null, redirected: false };
}

export function createGuardedFetch(base: typeof fetch, recorder?: FetchRecorder): typeof fetch {
  return async (input, init) => {
    const response = await base(input, { ...init, redirect: 'manual' });
    if (recorder) recorder.lastStatus = response.status;
    if (REDIRECT_STATUSES.has(response.status)) {
      if (recorder) recorder.redirected = true;
      await response.body?.cancel();
      throw new RedirectBlockedError(response.status);
    }
    return response;
  };
}

let installed = false;
let originalFetch: typeof fetch | null = null;

export function installGlobalFetchGuard(): void {
  if (installed) return;
  originalFetch = globalThis.fetch;
  globalThis.fetch = createGuardedFetch(originalFetch);
  installed = true;
}

export function unguardedFetch(): typeof fetch {
  return originalFetch ?? globalThis.fetch;
}
