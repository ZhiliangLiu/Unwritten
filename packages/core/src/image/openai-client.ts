import { ImageError } from './errors.ts';
import { IMAGE_EXTENSION, IMAGE_MAX_BYTES, type ImageMime } from './limits.ts';
import { createNetFetch, RedirectBlockedError } from '../net/fetch.ts';

export const OPENAI_IMAGE_TIMEOUT_MS = 180_000;

const RESPONSE_LIMIT_BYTES = Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 64 * 1024;
const ERROR_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_RETRY_AFTER_MS = 2_000;
const CONNECTION_FAILURE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);

export interface OpenAiImageRequest {
  prompt: string;
  references: Array<{ mime: string; bytes: Uint8Array }>;
  size: { width: number; height: number };
  quality: 'fast' | 'best';
}

export interface OpenAiImageResult {
  bytes: Uint8Array;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface OpenAiImageClient {
  generate(request: OpenAiImageRequest, signal: AbortSignal): Promise<OpenAiImageResult>;
  listModels(signal: AbortSignal): Promise<void>;
}

interface ErrorInfo {
  code: string | null;
  param: string | null;
}

function rewriteReferences(prompt: string): string {
  return prompt.replace(/\{\{ref:(\d+)\}\}/gu, 'input image $1');
}

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const cause = error.cause;
  if (typeof cause !== 'object' || cause === null) return false;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' && CONNECTION_FAILURE_CODES.has(code);
}

function parseRetryAfterMs(header: string | null): number {
  if (header === null) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return DEFAULT_RETRY_AFTER_MS;
}

function parseErrorBody(text: string): ErrorInfo {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return { code: null, param: null };
    const error = (parsed as { error?: unknown }).error;
    if (typeof error !== 'object' || error === null) return { code: null, param: null };
    const code = (error as { code?: unknown }).code;
    const param = (error as { param?: unknown }).param;
    return {
      code: typeof code === 'string' ? code : null,
      param: typeof param === 'string' ? param : null,
    };
  } catch {
    return { code: null, param: null };
  }
}

function base64ImageOf(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const data = (parsed as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const first: unknown = data[0];
  if (typeof first !== 'object' || first === null) return null;
  const base64 = (first as { b64_json?: unknown }).b64_json;
  return typeof base64 === 'string' && base64.length > 0 ? base64 : null;
}

function tokenCountOf(parsed: unknown, key: 'input_tokens' | 'output_tokens'): number | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const usage = (parsed as { usage?: unknown }).usage;
  if (typeof usage !== 'object' || usage === null) return null;
  const value = (usage as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : null;
}

export function createOpenAiImageClient(options: {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): OpenAiImageClient {
  const baseUrl = options.baseUrl.replace(/\/+$/u, '');
  const fetchImpl = options.fetch ?? createNetFetch();
  const timeoutMs = options.timeoutMs ?? OPENAI_IMAGE_TIMEOUT_MS;
  const headers: Record<string, string> = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {};

  async function send(url: string, init: RequestInit, callerSignal: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([callerSignal, timeout]);
    try {
      return await fetchImpl(url, { ...init, signal });
    } catch (error) {
      if (callerSignal.aborted) throw error;
      if (error instanceof RedirectBlockedError) {
        throw new ImageError('image_redirected', 'final', { cause: error });
      }
      if (timeout.aborted) {
        throw new ImageError('image_timeout', 'final', { submitted: true, cause: error });
      }
      if (isConnectionFailure(error)) {
        throw new ImageError('image_offline', 'transport', { submitted: false, cause: error });
      }
      throw new ImageError('image_outcome_unknown', 'final', { submitted: true, cause: error });
    }
  }

  async function readErrorInfo(response: Response): Promise<ErrorInfo> {
    if (!response.body) return { code: null, param: null };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > ERROR_BODY_LIMIT_BYTES) {
          await reader.cancel().catch(() => {});
          return { code: null, param: null };
        }
        chunks.push(value);
      }
    } catch {
      await reader.cancel().catch(() => {});
      return { code: null, param: null };
    }
    return parseErrorBody(Buffer.concat(chunks).toString('utf8'));
  }

  function httpError(status: number, retryAfter: string | null, info: ErrorInfo): ImageError {
    if (status === 401 || status === 403) return new ImageError('image_unauthorized', 'final');
    if (status === 429) {
      if (info.code === 'insufficient_quota') return new ImageError('image_quota', 'final');
      return new ImageError('image_rate_limited', 'busy', { retryAfterMs: parseRetryAfterMs(retryAfter) });
    }
    if (status === 400) {
      if (info.code === 'moderation_blocked') return new ImageError('image_refused', 'final');
      if (info.code === 'size' || info.param === 'size') {
        return new ImageError('image_output_format_unavailable', 'format');
      }
      return new ImageError('image_invalid_request', 'final');
    }
    if (status >= 500) return new ImageError('image_outcome_unknown', 'final', { submitted: true });
    return new ImageError('image_invalid_request', 'final');
  }

  async function readCappedText(response: Response, callerSignal: AbortSignal): Promise<string> {
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > RESPONSE_LIMIT_BYTES) throw new ImageError('image_invalid_response', 'final');
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof ImageError) throw error;
      if (callerSignal.aborted) throw error;
      throw new ImageError('image_outcome_unknown', 'final', { submitted: true, cause: error });
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async function generate(request: OpenAiImageRequest, callerSignal: AbortSignal): Promise<OpenAiImageResult> {
    const prompt = rewriteReferences(request.prompt);
    const quality = request.quality === 'fast' ? 'low' : 'high';
    const size = `${request.size.width}x${request.size.height}`;

    let response: Response;
    if (request.references.length === 0) {
      response = await send(
        `${baseUrl}/images/generations`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: options.model,
            prompt,
            n: 1,
            size,
            quality,
            output_format: 'webp',
            moderation: 'auto',
          }),
        },
        callerSignal,
      );
    } else {
      const form = new FormData();
      form.append('model', options.model);
      form.append('prompt', prompt);
      form.append('n', '1');
      form.append('size', size);
      form.append('quality', quality);
      form.append('output_format', 'webp');
      for (const [index, reference] of request.references.entries()) {
        const extension = IMAGE_EXTENSION[reference.mime as ImageMime];
        form.append('image[]', new Blob([reference.bytes], { type: reference.mime }), `ref-${index + 1}.${extension}`);
      }
      response = await send(`${baseUrl}/images/edits`, { method: 'POST', headers, body: form }, callerSignal);
    }

    if (!response.ok) {
      const info = await readErrorInfo(response);
      if (callerSignal.aborted) throw callerSignal.reason;
      throw httpError(response.status, response.headers.get('retry-after'), info);
    }

    const text = await readCappedText(response, callerSignal);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ImageError('image_invalid_response', 'final');
    }
    const base64 = base64ImageOf(parsed);
    if (base64 === null) throw new ImageError('image_invalid_response', 'final');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > IMAGE_MAX_BYTES) throw new ImageError('image_invalid_response', 'final');

    return {
      bytes,
      inputTokens: tokenCountOf(parsed, 'input_tokens'),
      outputTokens: tokenCountOf(parsed, 'output_tokens'),
    };
  }

  async function listModels(callerSignal: AbortSignal): Promise<void> {
    const response = await send(`${baseUrl}/models`, { method: 'GET', headers }, callerSignal);
    if (response.ok) {
      if (response.body) await response.body.cancel().catch(() => {});
      return;
    }
    const info = await readErrorInfo(response);
    if (callerSignal.aborted) throw callerSignal.reason;
    throw httpError(response.status, response.headers.get('retry-after'), info);
  }

  return { generate, listModels };
}
