import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { IDLE_MINUTES_MAX, IDLE_MINUTES_MIN, type LauncherState } from '@unwritten/contracts';

export interface FakeLauncherStep {
  state: LauncherState;
  afterMs: number;
  reason?: string;
  actionUrl?: string;
}

interface FakeLauncherState {
  state: LauncherState;
  reason: string | null;
  action: { url: string; expiresAt: number } | null;
  since: number;
}

export interface FakeLauncher {
  url: string;
  token: string;
  requests: Array<{ method: string; path: string; body: unknown }>;
  script(steps: FakeLauncherStep[]): void;
  setState(state: LauncherState, extra?: { reason?: string; action?: { url: string; expiresAt: number } }): void;
  startCalls(): number;
  close(): Promise<void>;
}

const DEFAULT_TOKEN = 'fake-launcher-token-0123456789abcdef0123456789';
const DEFAULT_SCRIPT: FakeLauncherStep[] = [
  { state: 'needs_action', afterMs: 30, actionUrl: 'https://accounts.example.test/consent' },
];
const CONTINUE_DELAY_MS = 30;
const STOP_DELAY_MS = 10;
const ACTION_LIFETIME_S = 600;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function startFakeLauncher(options?: { token?: string }): Promise<FakeLauncher> {
  const token = options?.token ?? DEFAULT_TOKEN;
  const requests: FakeLauncher['requests'] = [];
  const sockets = new Set<Socket>();
  let steps = [...DEFAULT_SCRIPT];
  let stepIndex = 0;
  let current: FakeLauncherState = { state: 'stopped', reason: null, action: null, since: nowSeconds() };
  let actionExpiresAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingStart = false;
  let startCount = 0;
  let server: Server;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const enter = (
    state: LauncherState,
    extra?: { reason?: string; action?: { url: string; expiresAt: number } },
  ): void => {
    clearTimer();
    current = { state, reason: extra?.reason ?? null, action: extra?.action ?? null, since: nowSeconds() };
  };

  const scheduleNextStep = (): void => {
    clearTimer();
    const step = steps[stepIndex];
    if (!step) return;
    timer = setTimeout(() => {
      timer = null;
      stepIndex += 1;
      enter(step.state, {
        reason: step.reason,
        action: step.actionUrl ? { url: step.actionUrl, expiresAt: actionExpiresAt } : undefined,
      });
      if (step.state === 'starting') scheduleNextStep();
    }, step.afterMs);
  };

  const beginStart = (): void => {
    stepIndex = 0;
    actionExpiresAt = nowSeconds() + ACTION_LIFETIME_S;
    enter('starting');
    scheduleNextStep();
  };

  const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  const sendError = (response: ServerResponse, status: number, code: string): void => {
    sendJson(response, status, { error: { code, message: code } });
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let body: unknown = null;
    if (chunks.length > 0) {
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = null;
      }
    }
    const method = request.method ?? 'GET';
    const path = request.url ?? '';
    requests.push({ method, path, body });

    if (request.headers.authorization !== `Bearer ${token}`) {
      sendError(response, 401, 'unauthorized');
      return;
    }

    if (method === 'GET' && path === '/v1/info') {
      sendJson(response, 200, {
        protocol: 'unwritten-launcher/1',
        implementation: { name: 'Fake', version: '0.0.0' },
        ready: true,
        notReadyReason: null,
        capabilities: {},
      });
      return;
    }

    if (method === 'GET' && path === '/v1/state') {
      sendJson(response, 200, current);
      return;
    }

    if (method === 'POST' && path === '/v1/start') {
      startCount += 1;
      const idleMinutes = isRecord(body) ? body.idleMinutes : undefined;
      if (
        typeof idleMinutes !== 'number' ||
        !Number.isInteger(idleMinutes) ||
        idleMinutes < IDLE_MINUTES_MIN ||
        idleMinutes > IDLE_MINUTES_MAX
      ) {
        sendError(response, 400, 'invalid_request');
        return;
      }
      if (current.state === 'starting' || current.state === 'needs_action' || current.state === 'running') {
        sendJson(response, 202, current);
        return;
      }
      if (current.state === 'stopping') {
        pendingStart = true;
        sendJson(response, 202, current);
        return;
      }
      beginStart();
      sendJson(response, 202, current);
      return;
    }

    if (method === 'POST' && path === '/v1/continue') {
      if (current.state !== 'needs_action') {
        sendError(response, 409, 'invalid_state');
        return;
      }
      enter('starting');
      if (stepIndex < steps.length) {
        scheduleNextStep();
      } else {
        timer = setTimeout(() => {
          timer = null;
          enter('running');
        }, CONTINUE_DELAY_MS);
      }
      sendJson(response, 202, current);
      return;
    }

    if (method === 'POST' && path === '/v1/stop') {
      if (current.state === 'stopped' || current.state === 'stopping') {
        sendJson(response, 202, current);
        return;
      }
      enter('stopping');
      timer = setTimeout(() => {
        timer = null;
        enter('stopped');
        if (pendingStart) {
          pendingStart = false;
          beginStart();
        }
      }, STOP_DELAY_MS);
      sendJson(response, 202, current);
      return;
    }

    sendError(response, 404, 'not_found');
  };

  server = createServer((request, response) => {
    response.on('close', () => {
      if (!response.writableEnded) response.socket?.destroy();
    });
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'internal', message: 'fake launcher failure' } }));
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
        reject(new Error('fake launcher did not get a port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        token,
        requests,
        script(next) {
          clearTimer();
          steps = [...next];
          stepIndex = 0;
        },
        setState(state, extra) {
          clearTimer();
          stepIndex = steps.length;
          pendingStart = false;
          current = {
            state,
            reason: extra?.reason ?? null,
            action: extra?.action ?? null,
            since: nowSeconds(),
          };
        },
        startCalls() {
          return startCount;
        },
        async close() {
          clearTimer();
          for (const socket of sockets) socket.destroy();
          sockets.clear();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}
