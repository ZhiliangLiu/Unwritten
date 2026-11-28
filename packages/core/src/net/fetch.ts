import { LLM_LOG_BODY_MAX_CHARS, type LlmHttpExchange } from '@unwritten/contracts';

export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TRUNCATED_MARKER = '\n…[truncated]';

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
  exchanges: LlmHttpExchange[];
  capture: boolean;
  track(promise: Promise<void>): void;
  flush(): Promise<void>;
}

export function createFetchRecorder(capture = false): FetchRecorder {
  const pending: Promise<void>[] = [];
  return {
    lastStatus: null,
    redirected: false,
    exchanges: [],
    capture,
    track(promise) {
      pending.push(promise);
    },
    async flush() {
      await Promise.allSettled(pending);
      pending.length = 0;
    },
  };
}

function truncate(text: string): string {
  return text.length > LLM_LOG_BODY_MAX_CHARS ? `${text.slice(0, LLM_LOG_BODY_MAX_CHARS)}${TRUNCATED_MARKER}` : text;
}

function requestBodyOf(init: RequestInit | undefined): string | null {
  const body = init?.body;
  if (typeof body === 'string') return truncate(body);
  if (body instanceof URLSearchParams) return truncate(body.toString());
  return null;
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length <= LLM_LOG_BODY_MAX_CHARS) {
      const { done, value } = await reader.read();
      if (done) return `${text}${decoder.decode()}`;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => {});
    return `${text.slice(0, LLM_LOG_BODY_MAX_CHARS)}${TRUNCATED_MARKER}`;
  } catch (error) {
    await reader.cancel().catch(() => {});
    const reason = error instanceof Error ? error.message : String(error);
    return `${text}\n…[read failed: ${reason}]`;
  }
}

export function createGuardedFetch(base: typeof fetch, recorder?: FetchRecorder): typeof fetch {
  return async (input, init) => {
    const response = await base(input, { ...init, redirect: 'manual' });
    if (recorder) {
      recorder.lastStatus = response.status;
      if (recorder.capture) {
        const exchange: LlmHttpExchange = {
          seq: recorder.exchanges.length + 1,
          method: (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase(),
          url: input instanceof Request ? input.url : String(input),
          status: response.status,
          requestBody: requestBodyOf(init),
          responseBody: null,
          error: null,
        };
        recorder.exchanges.push(exchange);
        if (REDIRECT_STATUSES.has(response.status)) {
          exchange.error = `redirect ${response.status}`;
        } else {
          try {
            const clone = response.clone();
            recorder.track(
              readCapped(clone).then(
                (text) => {
                  exchange.responseBody = text;
                },
                (error: unknown) => {
                  exchange.error = error instanceof Error ? error.message : String(error);
                },
              ),
            );
          } catch (error) {
            exchange.error = error instanceof Error ? error.message : String(error);
          }
        }
      }
    }
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

export function createNetFetch(recorder?: FetchRecorder): typeof fetch {
  return createGuardedFetch(unguardedFetch(), recorder);
}
