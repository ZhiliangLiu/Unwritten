import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { IMAGE_MAX_BYTES } from '@unwritten/contracts';
import { pngBytes } from './image-bytes.ts';

export interface FakeOpenAiImageUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export type FakeOpenAiImagesStep =
  | { kind: 'image'; width: number; height: number; usage?: FakeOpenAiImageUsage }
  | { kind: 'error'; status: number; code?: string; retryAfter?: string }
  | { kind: 'redirect' }
  | { kind: 'hang' }
  | { kind: 'oversize' };

export interface RecordedOpenAiImageRequest {
  path: string;
  authorization: string | null;
  contentType: string | null;
  json: unknown;
  fields: Record<string, string>;
  images: Array<{ name: string; type: string; filename: string; bytes: number }>;
}

export interface FakeOpenAiImages {
  baseUrl: string;
  requests: RecordedOpenAiImageRequest[];
  enqueue(step: FakeOpenAiImagesStep): void;
  close(): Promise<void>;
}

const OVERSIZE_RESPONSE_BYTES = Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 2 * 1024 * 1024;
const OVERSIZE_CHUNK = `{"data":[{"b64_json":"${'A'.repeat(64 * 1024)}`;

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.join(',');
  return value ?? null;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

function drained(response: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      response.off('drain', done);
      response.off('close', done);
      resolve();
    };
    response.once('drain', done);
    response.once('close', done);
  });
}

export function startFakeOpenAiImages(options?: { apiKey?: string }): Promise<FakeOpenAiImages> {
  const steps: FakeOpenAiImagesStep[] = [];
  const requests: RecordedOpenAiImageRequest[] = [];
  const sockets = new Set<Socket>();
  let server: Server;

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const buffer = await readBody(request);
    const contentType = headerValue(request.headers['content-type']);
    const authorization = headerValue(request.headers.authorization);
    const record: RecordedOpenAiImageRequest = {
      path: request.url ?? '',
      authorization,
      contentType,
      json: null,
      fields: {},
      images: [],
    };
    if (contentType?.startsWith('multipart/form-data')) {
      const form = await new Request('http://127.0.0.1/', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: buffer,
      }).formData();
      for (const [name, value] of form.entries()) {
        if (typeof value === 'string') {
          record.fields[name] = value;
        } else {
          record.images.push({ name, type: value.type, filename: value.name, bytes: value.size });
        }
      }
    } else if (buffer.length > 0) {
      try {
        record.json = JSON.parse(buffer.toString('utf8'));
      } catch {
        record.json = null;
      }
    }
    requests.push(record);

    if (options?.apiKey && authorization !== `Bearer ${options.apiKey}`) {
      sendJson(response, 401, { error: { code: 'invalid_api_key', type: 'invalid_request_error' } });
      return;
    }

    const step = steps.shift();
    if (!step) {
      if (request.method === 'GET' && request.url === '/v1/models') {
        sendJson(response, 200, { data: [] });
        return;
      }
      sendJson(response, 500, { error: { message: 'no scripted response' } });
      return;
    }

    if (step.kind === 'image') {
      const bytes = pngBytes(step.width, step.height);
      sendJson(response, 200, {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: Buffer.from(bytes).toString('base64') }],
        ...(step.usage ? { usage: step.usage } : {}),
      });
      return;
    }
    if (step.kind === 'error') {
      sendJson(
        response,
        step.status,
        { error: { code: step.code ?? null, type: 'invalid_request_error', param: null, message: 'fake error' } },
        step.retryAfter === undefined ? {} : { 'retry-after': step.retryAfter },
      );
      return;
    }
    if (step.kind === 'redirect') {
      response.writeHead(302, { location: 'https://example.invalid/redirected' });
      response.end();
      return;
    }
    if (step.kind === 'hang') {
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    let written = 0;
    while (written < OVERSIZE_RESPONSE_BYTES && !response.destroyed) {
      written += OVERSIZE_CHUNK.length;
      if (!response.write(OVERSIZE_CHUNK)) await drained(response);
    }
    response.end();
  };

  server = createServer((request, response) => {
    request.on('error', () => {});
    response.on('error', () => {});
    response.on('close', () => {
      if (!response.writableEnded) response.socket?.destroy();
    });
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'fake server failure' } }));
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
        reject(new Error('fake server did not get a port'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        requests,
        enqueue(step) {
          steps.push(step);
        },
        async close() {
          for (const socket of sockets) socket.destroy();
          sockets.clear();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}
