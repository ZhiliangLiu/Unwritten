import { createServer, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { ImageCapabilities, ImageSize } from '@unwritten/contracts';
import { TINY_WEBP, pngBytes } from './image-bytes.ts';

export interface FakeImageServerOptions {
  token?: string;
  capabilities?: Partial<ImageCapabilities>;
  output?: 'tiny-webp' | 'png';
  jobDelayMs?: number;
  implementation?: { name: string; version: string };
}

export interface FakeImageRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

export interface FakeImageServer {
  url: string;
  token: string;
  requests: FakeImageRequest[];
  setReady(ready: boolean, reason?: string | null): void;
  holdNextJob(): () => void;
  failNextJob(code: 'out_of_memory' | 'workflow_error' | 'refused' | 'interrupted' | 'internal'): void;
  respondNext(status: number, body: unknown, headers?: Record<string, string>): void;
  setCapabilities(capabilities: Partial<ImageCapabilities>): void;
  close(): Promise<void>;
}

const DEFAULT_TOKEN = 'fake-image-token-0123456789abcdef0123456789';
const DEFAULT_CAPABILITIES: ImageCapabilities = {
  maxReferences: 4,
  maxReferenceBytes: 8 * 1024 * 1024,
  maxPromptLength: 4000,
  seed: true,
  negativePrompt: false,
  qualities: ['fast', 'best'],
  aspects: ['1:1', '3:2', '2:3', '3:4', '4:3'],
  resolutions: {
    '1:1': {
      '720': { width: 720, height: 720 },
      '1k': { width: 1024, height: 1024 },
      '2k': { width: 2048, height: 2048 },
    },
    '3:2': {
      '720': { width: 1088, height: 720 },
      '1k': { width: 1536, height: 1024 },
    },
    '3:4': {
      '720': { width: 720, height: 960 },
      '1k': { width: 1024, height: 1360 },
    },
    '2:3': {
      '720': { width: 720, height: 1088 },
      '1k': { width: 1024, height: 1536 },
    },
    '4:3': {
      '720': { width: 960, height: 720 },
      '1k': { width: 1360, height: 1024 },
    },
  },
};

type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

interface Job {
  id: string;
  status: JobStatus;
  seed: number;
  width: number;
  height: number;
  error: { code: string; message: string } | null;
}

interface Override {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

interface Hold {
  promise: Promise<void>;
  release: () => void;
}

const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

function error(response: ServerResponse, status: number, code: string, message: string): void {
  json(response, status, { error: { code, message } });
}

async function writeStream(response: ServerResponse, stream: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const chunk of stream) {
    if (response.destroyed) return;
    if (!response.write(chunk)) {
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          response.off('drain', finish);
          response.off('close', finish);
          resolve();
        };
        response.once('drain', finish);
        response.once('close', finish);
      });
    }
  }
  if (!response.destroyed) response.end();
}

async function writeBody(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string>,
): Promise<void> {
  if (body === null || body === undefined || body instanceof Uint8Array || typeof body === 'string') {
    response.writeHead(status, headers);
    response.end(body ?? undefined);
    return;
  }
  if (typeof body === 'object' && Symbol.asyncIterator in body) {
    response.writeHead(status, headers);
    await writeStream(response, body as AsyncIterable<Uint8Array>);
    return;
  }
  const finalHeaders = { 'content-type': 'application/json', ...headers };
  response.writeHead(status, finalHeaders);
  response.end(JSON.stringify(body));
}

function smallestSize(resolutions: Record<string, Record<string, ImageSize>>, aspect: string): ImageSize | null {
  const tiers = resolutions[aspect];
  if (tiers === undefined) return null;
  let smallest: ImageSize | null = null;
  for (const size of Object.values(tiers)) {
    if (smallest === null || size.width * size.height < smallest.width * smallest.height) smallest = size;
  }
  return smallest;
}

export function startFakeImageServer(options?: FakeImageServerOptions): Promise<FakeImageServer> {
  const token = options?.token ?? DEFAULT_TOKEN;
  const implementation = options?.implementation ?? { name: 'Fake', version: '0.0.0' };
  const output = options?.output ?? 'png';
  const jobDelayMs = options?.jobDelayMs ?? 20;
  const capabilities: ImageCapabilities = {
    ...DEFAULT_CAPABILITIES,
    ...options?.capabilities,
    resolutions: { ...DEFAULT_CAPABILITIES.resolutions, ...options?.capabilities?.resolutions },
  };

  const requests: FakeImageRequest[] = [];
  const jobs = new Map<string, Job>();
  const idempotency = new Map<string, { id: string; body: string }>();
  const overrides: Override[] = [];
  const sockets = new Set<Socket>();
  const timers = new Set<NodeJS.Timeout>();
  let pendingHold: Hold | null = null;
  let nextFailure: 'out_of_memory' | 'workflow_error' | 'refused' | 'interrupted' | 'internal' | null = null;
  let ready = true;
  let notReadyReason: string | null = null;
  let server: Server;

  const complete = (job: Job, failure: string | null): void => {
    if (jobs.get(job.id) !== job) return;
    job.status = failure === null ? 'done' : 'failed';
    job.error = failure === null ? null : { code: failure, message: failure };
  };

  const schedule = (job: Job, failure: string | null, hold: Hold | null): void => {
    if (hold !== null) {
      void hold.promise.then(() => complete(job, failure));
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      complete(job, failure);
    }, jobDelayMs);
    timers.add(timer);
  };

  const validateReferences = (body: Record<string, unknown>): { status: number; code: string } | null => {
    const references = body.references;
    if (references === undefined) return null;
    if (!Array.isArray(references)) return { status: 400, code: 'invalid_request' };
    if (references.length > capabilities.maxReferences) return { status: 400, code: 'too_many_references' };
    for (const reference of references) {
      if (!isRecord(reference) || typeof reference.mime !== 'string' || typeof reference.data !== 'string') {
        return { status: 400, code: 'invalid_request' };
      }
      if (!MIME_TYPES.has(reference.mime)) return { status: 400, code: 'invalid_request' };
      const maxBytes = capabilities.maxReferenceBytes;
      if (maxBytes !== null && Buffer.from(reference.data, 'base64').length > maxBytes) {
        return { status: 413, code: 'reference_too_large' };
      }
    }
    return null;
  };

  const validateSize = (body: Record<string, unknown>, aspect: string): { status: number; code: string } | null => {
    if (body.size === undefined) return null;
    const size = body.size;
    if (!isRecord(size) || !isPositiveInteger(size.width) || !isPositiveInteger(size.height)) {
      return { status: 400, code: 'invalid_request' };
    }
    const tiers = capabilities.resolutions[aspect];
    if (
      tiers === undefined ||
      !Object.values(tiers).some((entry) => entry.width === size.width && entry.height === size.height)
    ) {
      return { status: 400, code: 'unsupported_size' };
    }
    return null;
  };

  const validateJob = (body: Record<string, unknown>): { status: number; code: string } | null => {
    if (typeof body.prompt !== 'string' || body.prompt.length === 0) return { status: 400, code: 'invalid_request' };
    const maxPromptLength = capabilities.maxPromptLength;
    if (maxPromptLength !== null && body.prompt.length > maxPromptLength) {
      return { status: 400, code: 'invalid_request' };
    }
    if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length === 0) {
      return { status: 400, code: 'invalid_request' };
    }
    if (typeof body.aspect !== 'string' || !capabilities.aspects.includes(body.aspect)) {
      return { status: 400, code: 'unsupported_aspect' };
    }
    if (typeof body.quality !== 'string' || !capabilities.qualities.includes(body.quality as 'fast' | 'best')) {
      return { status: 400, code: 'unsupported_quality' };
    }
    const referenceError = validateReferences(body);
    if (referenceError !== null) return referenceError;
    return validateSize(body, body.aspect);
  };

  const submit = (response: ServerResponse, rawBody: string, body: Record<string, unknown>): void => {
    if (!ready) {
      error(response, 503, 'not_ready', 'service is not ready');
      return;
    }
    const invalid = validateJob(body);
    if (invalid !== null) {
      error(response, invalid.status, invalid.code, invalid.code);
      return;
    }

    const key = body.idempotencyKey as string;
    const existing = idempotency.get(key);
    if (existing !== undefined) {
      if (existing.body !== rawBody) {
        error(response, 409, 'idempotency_conflict', 'idempotency key reused with a different request body');
        return;
      }
      json(response, 202, { id: existing.id, status: 'queued' });
      return;
    }

    const id = randomUUID();
    const aspect = body.aspect as string;
    const size = isRecord(body.size) ? { width: body.size.width as number, height: body.size.height as number } : null;
    const fallback = smallestSize(capabilities.resolutions, aspect);
    const job: Job = {
      id,
      status: 'running',
      seed:
        typeof body.seed === 'number' && Number.isInteger(body.seed) ? body.seed : Math.floor(Math.random() * 2 ** 31),
      width: size?.width ?? fallback?.width ?? 1024,
      height: size?.height ?? fallback?.height ?? 1024,
      error: null,
    };
    jobs.set(id, job);
    idempotency.set(key, { id, body: rawBody });

    const failure = nextFailure;
    nextFailure = null;
    const hold = pendingHold;
    pendingHold = null;
    schedule(job, failure, hold);

    json(response, 202, { id, status: 'queued' });
  };

  const jobStatus = (job: Job): Record<string, unknown> => ({
    id: job.id,
    status: job.status,
    ...(job.status === 'queued' ? { position: 0 } : {}),
    seed: job.seed,
    width: job.width,
    height: job.height,
    error: job.error,
  });

  const handle = async (request: import('node:http').IncomingMessage, response: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let body: unknown = null;
    let malformed = false;
    if (rawBody.length > 0) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        malformed = true;
      }
    }

    const authorization = request.headers.authorization ?? null;
    const method = request.method ?? 'GET';
    const path = request.url ?? '/';
    requests.push({ method, path, authorization, body });

    if (authorization !== `Bearer ${token}`) {
      error(response, 401, 'unauthorized', 'missing or invalid token');
      return;
    }

    if (malformed) {
      error(response, 400, 'invalid_request', 'request body must be JSON');
      return;
    }

    const override = overrides.shift();
    if (override !== undefined) {
      await writeBody(response, override.status, override.body, override.headers);
      return;
    }

    const url = new URL(path, 'http://127.0.0.1');
    if (method === 'GET' && url.pathname === '/v1/info') {
      json(response, 200, {
        protocol: 'unwritten-image/1',
        implementation,
        model: null,
        ready,
        notReadyReason: ready ? null : notReadyReason,
        capabilities,
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/v1/jobs') {
      if (!isRecord(body)) {
        error(response, 400, 'invalid_request', 'request body must be a JSON object');
        return;
      }
      submit(response, rawBody, body);
      return;
    }

    const match = /^\/v1\/jobs\/([^/]+)(\/image)?$/u.exec(url.pathname);
    if (match !== null) {
      const id = decodeURIComponent(match[1] ?? '');
      const wantsImage = match[2] === '/image';
      const job = jobs.get(id);
      if (job === undefined) {
        error(response, 404, 'not_found', 'job not found');
        return;
      }
      if (wantsImage && method === 'GET') {
        if (job.status !== 'done') {
          error(response, 404, 'not_found', 'job result is not available');
          return;
        }
        const bytes = output === 'tiny-webp' ? TINY_WEBP : pngBytes(job.width, job.height);
        response.writeHead(200, { 'content-type': output === 'tiny-webp' ? 'image/webp' : 'image/png' });
        response.end(bytes);
        return;
      }
      if (!wantsImage && method === 'GET') {
        json(response, 200, jobStatus(job));
        return;
      }
      if (!wantsImage && method === 'DELETE') {
        job.status = 'cancelled';
        jobs.delete(id);
        response.writeHead(204);
        response.end();
        return;
      }
    }

    error(response, 404, 'not_found', 'unknown route');
  };

  server = createServer((request, response) => {
    response.on('close', () => {
      if (!response.writableEnded) response.socket?.destroy();
    });
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'internal', message: 'fake server failure' } }));
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('fake image server did not get a port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        token,
        requests,
        setReady(value, reason) {
          ready = value;
          notReadyReason = value ? null : reason === undefined ? 'starting' : reason;
        },
        holdNextJob() {
          let release: () => void = () => {};
          const promise = new Promise<void>((done) => {
            release = done;
          });
          const hold: Hold = { promise, release };
          pendingHold = hold;
          return () => {
            hold.release();
          };
        },
        failNextJob(code) {
          nextFailure = code;
        },
        respondNext(status, body, headers) {
          overrides.push({ status, body, headers: headers ?? {} });
        },
        setCapabilities(partial) {
          Object.assign(capabilities, partial);
        },
        async close() {
          for (const timer of timers) clearTimeout(timer);
          timers.clear();
          for (const socket of sockets) socket.destroy();
          sockets.clear();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}
