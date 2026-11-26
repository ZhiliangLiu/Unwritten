import { createServer, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

export type FakeStep =
  | { kind: 'tool_call'; name: string; arguments: string }
  | { kind: 'text'; text: string; chunkDelayMs?: number }
  | { kind: 'thinking_then_tool_call'; thinking: string; chunkDelayMs: number; name: string; arguments: string }
  | { kind: 'http_error'; status: number; message: string }
  | { kind: 'redirect'; status: 301 | 302 | 303 | 307 | 308; location: string }
  | { kind: 'drop_mid_stream' }
  | { kind: 'hang' };

export interface RecordedRequest {
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeOpenAiServer {
  baseUrl: string;
  enqueue(...steps: FakeStep[]): void;
  pending(): number;
  requests: RecordedRequest[];
  reset(): void;
  close(): Promise<void>;
}

function newId(): string {
  return `chatcmpl-${Math.random().toString(36).slice(2, 12)}`;
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function chunk(model: string, delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: newId(),
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function sendSse(response: ServerResponse, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendToolCall(
  response: ServerResponse,
  step: Extract<FakeStep, { kind: 'tool_call' }>,
  model: string,
  stream: boolean,
  promptTokens: number,
): void {
  const toolCall = {
    index: 0,
    id: `call_${Math.random().toString(36).slice(2, 10)}`,
    type: 'function',
    function: { name: step.name, arguments: step.arguments },
  };
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: estimateTokens(step.arguments),
    total_tokens: promptTokens + estimateTokens(step.arguments),
  };
  if (!stream) {
    response.end(
      JSON.stringify({
        id: newId(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: null, tool_calls: [toolCall] },
            finish_reason: 'tool_calls',
          },
        ],
        usage,
      }),
    );
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  sendSse(
    response,
    chunk(model, {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          index: 0,
          id: toolCall.id,
          type: 'function',
          function: { name: step.name, arguments: '' },
        },
      ],
    }),
  );
  for (let index = 0; index < step.arguments.length; index += 40) {
    sendSse(
      response,
      chunk(model, { tool_calls: [{ index: 0, function: { arguments: step.arguments.slice(index, index + 40) } }] }),
    );
  }
  sendSse(response, chunk(model, {}, 'tool_calls'));
  sendSse(response, { ...chunk(model, {}), choices: [], usage });
  response.write('data: [DONE]\n\n');
  response.end();
}

async function sendText(
  response: ServerResponse,
  step: Extract<FakeStep, { kind: 'text' }>,
  model: string,
  stream: boolean,
  promptTokens: number,
): Promise<void> {
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: estimateTokens(step.text),
    total_tokens: promptTokens + estimateTokens(step.text),
  };
  if (!stream) {
    response.end(
      JSON.stringify({
        id: newId(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: step.text }, finish_reason: 'stop' }],
        usage,
      }),
    );
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  sendSse(response, chunk(model, { role: 'assistant', content: '' }));
  for (let index = 0; index < step.text.length; index += 40) {
    sendSse(response, chunk(model, { content: step.text.slice(index, index + 40) }));
    if (step.chunkDelayMs) await new Promise((resolve) => setTimeout(resolve, step.chunkDelayMs));
  }
  sendSse(response, chunk(model, {}, 'stop'));
  sendSse(response, { ...chunk(model, {}), choices: [], usage });
  response.write('data: [DONE]\n\n');
  response.end();
}

async function sendThinkingThenToolCall(
  response: ServerResponse,
  step: Extract<FakeStep, { kind: 'thinking_then_tool_call' }>,
  model: string,
  stream: boolean,
  promptTokens: number,
): Promise<void> {
  const toolCall = {
    index: 0,
    id: `call_${Math.random().toString(36).slice(2, 10)}`,
    type: 'function',
    function: { name: step.name, arguments: step.arguments },
  };
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: estimateTokens(step.arguments) + estimateTokens(step.thinking),
    total_tokens: promptTokens + estimateTokens(step.arguments) + estimateTokens(step.thinking),
  };
  if (!stream) {
    response.end(
      JSON.stringify({
        id: newId(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: null, reasoning_content: step.thinking, tool_calls: [toolCall] },
            finish_reason: 'tool_calls',
          },
        ],
        usage,
      }),
    );
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  sendSse(response, chunk(model, { role: 'assistant', content: null }));
  for (let index = 0; index < step.thinking.length; index += 20) {
    sendSse(response, chunk(model, { reasoning_content: step.thinking.slice(index, index + 20) }));
    await new Promise((resolve) => setTimeout(resolve, step.chunkDelayMs));
  }
  sendSse(
    response,
    chunk(model, {
      tool_calls: [
        {
          index: 0,
          id: toolCall.id,
          type: 'function',
          function: { name: toolCall.function.name, arguments: '' },
        },
      ],
    }),
  );
  for (let index = 0; index < step.arguments.length; index += 40) {
    sendSse(
      response,
      chunk(model, { tool_calls: [{ index: 0, function: { arguments: step.arguments.slice(index, index + 40) } }] }),
    );
  }
  sendSse(response, chunk(model, {}, 'tool_calls'));
  sendSse(response, { ...chunk(model, {}), choices: [], usage });
  response.write('data: [DONE]\n\n');
  response.end();
}

export function startFakeOpenAiServer(options?: { apiKey?: string }): Promise<FakeOpenAiServer> {
  const steps: FakeStep[] = [];
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();
  let server: Server;
  let baseUrl = '';

  const handle = async (request: import('node:http').IncomingMessage, response: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let body: unknown = null;
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid JSON' } }));
      return;
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : (value ?? '');
    }
    requests.push({ path: request.url ?? '', headers, body });

    if (options?.apiKey && headers.authorization !== `Bearer ${options.apiKey}`) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid api key', type: 'invalid_request_error' } }));
      return;
    }

    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }

    const step = steps.shift();
    if (!step) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'no scripted response' } }));
      return;
    }

    const payload = body as { model?: string; stream?: boolean };
    const model = typeof payload.model === 'string' ? payload.model : 'fake-model';
    const stream = payload.stream === true;
    const promptTokens = estimateTokens(JSON.stringify(body));

    if (step.kind === 'tool_call') {
      sendToolCall(response, step, model, stream, promptTokens);
      return;
    }
    if (step.kind === 'text') {
      await sendText(response, step, model, stream, promptTokens);
      return;
    }
    if (step.kind === 'thinking_then_tool_call') {
      await sendThinkingThenToolCall(response, step, model, stream, promptTokens);
      return;
    }
    if (step.kind === 'http_error') {
      response.writeHead(step.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: step.message } }));
      return;
    }
    if (step.kind === 'redirect') {
      response.writeHead(step.status, { location: step.location });
      response.end();
      return;
    }
    if (step.kind === 'drop_mid_stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      response.flushHeaders();
      sendSse(response, chunk(model, { role: 'assistant', content: '' }));
      sendSse(response, chunk(model, { content: '半' }));
      setImmediate(() => response.socket?.destroy());
      return;
    }
    return;
  };

  server = createServer((request, response) => {
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
      baseUrl = `http://127.0.0.1:${address.port}/v1`;
      resolve({
        baseUrl,
        enqueue(...next) {
          steps.push(...next);
        },
        pending() {
          return steps.length;
        },
        requests,
        reset() {
          steps.length = 0;
          requests.length = 0;
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
