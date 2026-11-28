import { spawn, type ChildProcess } from 'node:child_process';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ImageCapabilities, StartIllustrationInput, WorkDetail } from '../../../packages/contracts/src/index.ts';
import { DEFAULT_WORK_SETTINGS, EMPTY_WORK_ANCHORS } from '../../../packages/contracts/src/index.ts';
import {
  startFakeImageServer,
  type FakeImageServer,
} from '../../../packages/core/src/test-support/fake-image-server.ts';
import { startFakeLauncher, type FakeLauncher } from '../../../packages/core/src/test-support/fake-launcher.ts';
import {
  startFakeOpenAiImages,
  type FakeOpenAiImages,
} from '../../../packages/core/src/test-support/fake-openai-images.ts';
import {
  startFakeOpenAiServer,
  type FakeOpenAiServer,
} from '../../../packages/core/src/test-support/fake-openai-server.ts';
import {
  proposePlanStep,
  proposePreviewStep,
  proposeTurnStep,
} from '../../../packages/core/src/test-support/llm-steps.ts';

const corePath = fileURLToPath(new URL('../../../packages/core/dist/main.js', import.meta.url));

export type Api = Record<string, any>;

export const FIXTURE_BACKGROUND = '暮色刚落，候船厅停了电。主角坐在可以望见闸杆的长椅上，闸杆还没有扳下。';
export const FIXTURE_OPENING = '候船厅的灯没亮。短发的修表匠站在长椅一端，穿浅色雨衣的守门人站在另一端。';
export const FIXTURE_TURN_PARAGRAPHS = [
  '候船厅的灯没亮，短发的修表匠站在长椅一端，穿浅色雨衣的守门人站在另一端。',
  '修表匠摊开手掌，把一把黄铜钥匙递向守门人。守门人把戴手套的右手缩回胸前。钥匙还躺在修表匠的掌心里。',
  '守门人再伸出手，把钥匙接过去。',
  '守门人翻开一只怀表，表盖缝里露出一小截齿轮。',
  '守门人摘下兜帽，左侧颧骨上露出一块月牙形胎记。「我叫岑雾行。」说完走进信号室。',
];
export const FIXTURE_CAPTION = '短发的修表匠把钥匙递到半空，穿浅色雨衣的守门人缩回了手。';
export const SHOT_CAPTION = FIXTURE_CAPTION;
export function shotText(input: { caption: string; refs?: string; aspect?: string; prompt?: string }): string {
  const prompt =
    input.prompt ??
    'Medium shot in a dim waiting hall. A short-haired figure holds a brass key on an open palm, and a figure in a light raincoat stands opposite.';
  return `PROMPT: ${prompt}
NEGATIVE:
CAPTION: ${input.caption}
REFS: ${input.refs ?? ''}
ASPECT: ${input.aspect ?? '3:2'}`;
}

export const DEFAULT_SHOT_TEXT = `PROMPT: Medium two-shot in a dim waiting hall. A short-haired figure extends an open palm with a brass key resting on it. A figure in a light raincoat draws an empty gloved hand back.
NEGATIVE:
CAPTION: ${FIXTURE_CAPTION}
REFS:
ASPECT: 3:2`;

const SHOT_SYSTEM_MARKER = '给故事画一个定格镜头';

interface RecordedBackgroundRequest {
  shot: boolean;
  body: unknown;
}

export interface BackgroundModel {
  url: string;
  requests: RecordedBackgroundRequest[];
  shot(text: string): void;
  delayNextShot(ms: number): void;
  pendingShots(): number;
  close(): Promise<void>;
}

function sseChunk(content: string) {
  return {
    id: `chatcmpl-${Math.random().toString(36).slice(2, 12)}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'shot-model',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

export function startBackgroundModel(): Promise<BackgroundModel> {
  const shots: string[] = [];
  const requests: RecordedBackgroundRequest[] = [];
  let nextShotDelayMs = 0;
  const sockets = new Set<Socket>();
  let server: Server;

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: unknown = null;
    try {
      body = raw.length > 0 ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    const messages = (body as { messages?: Array<{ role?: string; content?: unknown }> } | null)?.messages ?? [];
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('\n');
    const shot = system.includes(SHOT_SYSTEM_MARKER);
    requests.push({ shot, body });
    if (shot && nextShotDelayMs > 0) {
      const delay = nextShotDelayMs;
      nextShotDelayMs = 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const text = shot ? (shots.length > 0 ? shots.shift()! : DEFAULT_SHOT_TEXT) : '这一回合的摘要。';
    const stream = (body as { stream?: boolean } | null)?.stream === true;
    if (!stream) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: `chatcmpl-${Math.random().toString(36).slice(2, 12)}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'shot-model',
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.write(
      `data: ${JSON.stringify({ ...sseChunk(''), choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`,
    );
    for (let index = 0; index < text.length; index += 40) {
      response.write(`data: ${JSON.stringify(sseChunk(text.slice(index, index + 40)))}\n\n`);
    }
    response.write(
      `data: ${JSON.stringify({ ...sseChunk(''), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ id: 'usage', object: 'chat.completion.chunk', created: 0, model: 'shot-model', choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`,
    );
    response.write('data: [DONE]\n\n');
    response.end();
  };

  server = createServer((request, response) => {
    response.on('close', () => {
      if (!response.writableEnded) response.socket?.destroy();
    });
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'background fake failure' } }));
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
        reject(new Error('background model did not get a port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/v1`,
        requests,
        shot(text) {
          shots.push(text);
        },
        delayNextShot(ms) {
          nextShotDelayMs = ms;
        },
        pendingShots() {
          return shots.length;
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

export interface StartAppOptions {
  providersVersion?: 1 | 2;
  image?: 'unwritten' | 'openai' | 'none';
  launcher?: boolean;
  autoIllustration?: boolean;
  imageSelected?: boolean;
  imageOptions?: {
    token?: string;
    capabilities?: Partial<ImageCapabilities>;
    output?: 'tiny-webp' | 'png';
    jobDelayMs?: number;
    implementation?: { name: string; version: string };
  };
  openaiModel?: string;
  openaiOptions?: { maxReferences: number; sizes: 'fixed' | 'custom' };
  tokenProxy?: boolean;
  imageGate?: boolean;
  launcherIdleMinutes?: number;
}

export interface FakeServices {
  text: FakeOpenAiServer;
  background: BackgroundModel;
  image: FakeImageServer | null;
  openai: FakeOpenAiImages | null;
  launcher: FakeLauncher | null;
  proxy: { close(): Promise<void> } | null;
  proxyUrl: string | null;
  openaiProxy: { close(): Promise<void> } | null;
  openaiRaw: Array<{ path: string; body: Buffer }>;
  imageGate: { setOnline(online: boolean): void; url: string; close(): Promise<void> } | null;
}

export interface E2eApp {
  dataDir: string;
  url: string;
  token: string;
  providersBytes: Buffer;
  api: Api;
  services: FakeServices;
  stop(options?: { keepDataDir?: boolean }): Promise<void>;
}

interface ProvidersFileShape {
  version: 1 | 2;
  endpoints: Array<Record<string, unknown>>;
  purposes: Record<string, Record<string, unknown>>;
  imageServices?: Array<Record<string, unknown>>;
  image?: { service: string | null };
}

export function providersFor(input: {
  version: 1 | 2;
  textUrl: string;
  backgroundUrl: string;
  imageUrl?: string | null;
  imageToken?: string | null;
  launcherUrl?: string | null;
  launcherToken?: string | null;
  idleMinutes?: number;
  selectImage?: boolean;
  protocol?: 'unwritten-image' | 'openai-images';
  model?: string | null;
  openai?: { maxReferences: number; sizes: 'fixed' | 'custom' } | null;
}): ProvidersFileShape {
  const file: ProvidersFileShape = {
    version: input.version,
    endpoints: [
      {
        id: 'test-endpoint',
        name: '测试端点',
        api: 'openai-completions',
        baseUrl: input.textUrl,
        models: [{ id: 'narrator-model' }, { id: 'shot-model' }],
      },
      {
        id: 'shot-endpoint',
        name: '镜头端点',
        api: 'openai-completions',
        baseUrl: input.backgroundUrl,
        models: [{ id: 'shot-model' }],
      },
    ],
    purposes: {
      narrator: { provider: 'test-endpoint', model: 'narrator-model' },
      author_chat: { provider: 'test-endpoint', model: 'narrator-model' },
      background: { provider: 'shot-endpoint', model: 'shot-model' },
    },
  };
  if (input.version === 2) {
    file.imageServices =
      input.imageUrl && input.imageToken
        ? [
            {
              id: 'image-local',
              name: '本地出图',
              protocol: input.protocol ?? 'unwritten-image',
              baseUrl: input.imageUrl,
              apiKey: input.imageToken,
              ...(input.protocol === 'openai-images'
                ? {
                    model: input.model ?? 'gpt-image-2',
                    capabilities: input.openai ?? { maxReferences: 4, sizes: 'custom' },
                  }
                : {}),
              ...(input.launcherUrl
                ? { launcher: { baseUrl: input.launcherUrl, apiKey: input.launcherToken ?? undefined } }
                : {}),
              ...(input.idleMinutes === undefined ? {} : { idleMinutes: input.idleMinutes }),
            },
          ]
        : [];
    file.image = { service: input.imageUrl && input.imageToken && input.selectImage !== false ? 'image-local' : null };
  }
  return file;
}

function imageTokenProxy(target: string, token: string): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  let server: Server;
  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    const targetUrl = new URL(request.url ?? '/', target);
    const proxyRequest = httpRequest(
      targetUrl,
      {
        method: request.method,
        headers: { ...request.headers, authorization: `Bearer ${token}`, host: targetUrl.host },
      },
      (proxyResponse) => {
        response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
        proxyResponse.pipe(response);
      },
    );
    proxyRequest.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'internal', message: 'proxy failure' } }));
    });
    request.pipe(proxyRequest);
  };
  server = createServer(handle);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('proxy did not get a port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        async close() {
          for (const socket of sockets) socket.destroy();
          sockets.clear();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}

function startImageGate(
  target: string,
): Promise<{ url: string; setOnline(online: boolean): void; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  let online = false;
  let server: Server;
  server = createServer((request, response) => {
    if (!online) {
      response.destroy();
      return;
    }
    const targetUrl = new URL(request.url ?? '/', target);
    const proxyRequest = httpRequest(
      targetUrl,
      { method: request.method, headers: { ...request.headers, host: targetUrl.host } },
      (proxyResponse) => {
        response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
        proxyResponse.pipe(response);
      },
    );
    proxyRequest.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'internal', message: 'gate failure' } }));
    });
    request.pipe(proxyRequest);
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
        reject(new Error('image gate did not get a port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        setOnline(value) {
          online = value;
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

function startCaptureProxy(
  targetOrigin: string,
  records: Array<{ path: string; body: Buffer }>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  let server: Server;
  server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      records.push({ path: request.url ?? '/', body });
      const targetUrl = new URL(request.url ?? '/', targetOrigin);
      const proxyRequest = httpRequest(
        targetUrl,
        {
          method: request.method,
          headers: { ...request.headers, host: targetUrl.host, 'content-length': String(body.length) },
        },
        (proxyResponse) => {
          response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
          proxyResponse.pipe(response);
        },
      );
      proxyRequest.on('error', () => {
        if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'internal', message: 'proxy failure' } }));
      });
      proxyRequest.end(body);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'internal', message: 'proxy failure' } }));
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
        reject(new Error('capture proxy did not get a port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        async close() {
          for (const socket of sockets) socket.destroy();
          sockets.clear();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}

function readUrl(output: string): string | null {
  const match = /UNWRITTEN_CORE_URL=(\S+)/.exec(output);
  return match?.[1] ?? null;
}

export function waitUntil<T>(
  read: () => T | Promise<T>,
  predicate: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  return new Promise<T>((resolve, reject) => {
    const poll = async (): Promise<void> => {
      try {
        const value = await read();
        if (predicate(value)) {
          resolve(value);
          return;
        }
      } catch (error) {
        if (Date.now() >= deadline) {
          reject(error);
          return;
        }
      }
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for ${options.label ?? 'condition'}`));
        return;
      }
      setTimeout(() => void poll(), intervalMs);
    };
    void poll();
  });
}

export function createApi(url: string): { api: Api; token: string } {
  const parsed = new URL(url);
  const token = new URLSearchParams(parsed.hash.slice(1)).get('token') ?? '';
  const link = new RPCLink({
    url: `${parsed.origin}/api`,
    headers: { authorization: `Bearer ${token}` },
  });
  return { api: createORPCClient(link) as Api, token };
}

export async function startApp(options: StartAppOptions = {}): Promise<E2eApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'unwritten-m4-'));
  const text = await startFakeOpenAiServer();
  const background = await startBackgroundModel();
  const image =
    options.image === 'unwritten' || options.image === undefined
      ? await startFakeImageServer(options.imageOptions)
      : null;
  const openai = options.image === 'openai' ? await startFakeOpenAiImages() : null;
  const launcher = options.launcher ? await startFakeLauncher() : null;
  const proxy = image && options.tokenProxy ? await imageTokenProxy(image.url, image.token) : null;
  const imageGate = image && options.imageGate ? await startImageGate(image.url) : null;
  const openaiRaw: Array<{ path: string; body: Buffer }> = [];
  const openaiProxy = openai === null ? null : await startCaptureProxy(new URL(openai.baseUrl).origin, openaiRaw);
  const version = options.providersVersion ?? 2;
  const protocol = options.image === 'openai' ? 'openai-images' : 'unwritten-image';
  const providers = providersFor({
    version,
    textUrl: text.baseUrl,
    backgroundUrl: background.url,
    imageUrl: image
      ? (imageGate?.url ?? (proxy ? proxy.url : image.url))
      : openaiProxy
        ? `${openaiProxy.url}/v1`
        : null,
    imageToken: image
      ? proxy
        ? 'generated-token-placeholder'
        : image.token
      : openai
        ? 'test-openai-key-0123456789abcdef0123456789'
        : null,
    selectImage: options.imageSelected !== false,
    launcherUrl: launcher?.url ?? null,
    launcherToken: launcher?.token ?? null,
    idleMinutes: options.launcherIdleMinutes,
    protocol,
    model: options.openaiModel,
    openai: options.openaiOptions,
  });
  const providersPath = join(dataDir, 'providers.json');
  const providersBytes = Buffer.from(JSON.stringify(providers, null, 2));
  writeFileSync(providersPath, providersBytes);
  let core: ChildProcess | null = null;
  let url: string;
  try {
    core = spawn(process.execPath, [corePath, '--data-dir', dataDir, '--log-level', 'info'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const child = core;
    url = await new Promise<string>((resolve, reject) => {
      let output = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('core did not start within 20s'));
      }, 20_000);
      child.stdout?.on('data', (chunk: Buffer) => {
        output += String(chunk);
        const found = readUrl(output);
        if (found && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve(found);
        }
      });
      child.once('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`core exited early: ${code ?? 'signal'}`));
      });
    });
  } catch (error) {
    core?.kill('SIGTERM');
    await proxy?.close();
    await imageGate?.close();
    await openaiProxy?.close();
    await image?.close();
    await openai?.close();
    await launcher?.close();
    await background.close();
    await text.close();
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
  const { api, token } = createApi(url);
  const services: FakeServices = {
    text,
    background,
    image,
    openai,
    launcher,
    proxy,
    proxyUrl: proxy?.url ?? null,
    openaiProxy,
    openaiRaw,
    imageGate,
  };
  const running = core;
  const stop = async (options: { keepDataDir?: boolean } = {}): Promise<void> => {
    running.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (running.exitCode !== null || running.signalCode !== null) {
        resolve();
        return;
      }
      running.once('exit', () => resolve());
    });
    await proxy?.close();
    await imageGate?.close();
    await openaiProxy?.close();
    await image?.close();
    await openai?.close();
    await launcher?.close();
    await background.close();
    await text.close();
    if (!options.keepDataDir) rmSync(dataDir, { recursive: true, force: true });
  };
  try {
    if (options.autoIllustration) {
      const view = await api.image.autoIllustration.get();
      if (view.current) await api.image.autoIllustration.set({ enabled: true, confirm: view.current });
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { dataDir, url, token, providersBytes, api, services, stop };
}

export interface FixtureWork {
  workId: string;
  detail: WorkDetail;
}

export interface DraftFixtureWork extends FixtureWork {
  entityId: (name: string) => string;
}

const FIXTURE_PLAN = {
  entities: [
    {
      ref: 'e1',
      kind: 'character',
      role: 'protagonist',
      name: '候船的旅人',
      known_as: '',
      profile: '在候船厅等船的旅客',
      appearance: '黑色短发，灰蓝色长外套，手里提着一只旧皮箱',
      from: 'ai',
    },
    {
      ref: 'e2',
      kind: 'character',
      role: 'cast',
      name: '榆既白',
      known_as: '短发的修表匠',
      profile: '在候船厅修表的匠人',
      appearance: '短卷发，左眉有一道浅缺口，穿深色短外套',
      from: 'ai',
    },
    {
      ref: 'e3',
      kind: 'character',
      role: 'cast',
      name: '岑雾行',
      known_as: '穿浅色雨衣的守门人',
      profile: '守着候船厅闸杆的人',
      appearance: '浅色雨衣的兜帽遮住脸，窄肩，右手戴浅色手套',
      from: 'ai',
    },
    {
      ref: 'e4',
      kind: 'character',
      role: 'other',
      name: '蒲泊',
      known_as: '传信人',
      profile: '只听过名字的传信人',
      appearance: '',
      from: 'ai',
    },
  ],
};

export async function createDraftFixture(app: E2eApp): Promise<DraftFixtureWork> {
  const work = await app.api.works.create({ workId: crypto.randomUUID() });
  const saved = await app.api.works.saveDraft({
    workId: work.id,
    baseContentRev: work.draft.contentRev,
    background: FIXTURE_BACKGROUND,
    anchors: EMPTY_WORK_ANCHORS,
    settings: DEFAULT_WORK_SETTINGS,
  });
  app.services.text.enqueue(proposePlanStep({ entities: FIXTURE_PLAN.entities }));
  await app.api.works.generatePlan({ workId: work.id, jobId: crypto.randomUUID(), contentRev: saved.contentRev });
  const withPlan = await waitUntil(
    () => app.api.works.get({ workId: work.id }),
    (detail) => detail.latestPlanJob?.status === 'done' || detail.latestPlanJob?.status === 'failed',
    { label: 'plan job', timeoutMs: 40_000 },
  );
  if (withPlan.latestPlanJob?.status !== 'done') {
    throw new Error(`plan job failed: ${withPlan.latestPlanJob?.error ?? 'unknown'}`);
  }
  await app.api.works.confirmPlan({ workId: work.id, baseContentRev: withPlan.draft.contentRev });
  await app.api.works.setWizardStep({ workId: work.id, step: 'plan' });
  const detail = await app.api.works.get({ workId: work.id });
  const entityId = (name: string): string => {
    const items = (detail.draft.plan?.items ?? []) as Array<{ kind: string; name?: string; id: string }>;
    const item = items.find((candidate) => candidate.kind === 'entity' && candidate.name === name);
    if (!item) throw new Error(`entity ${name} is missing from the plan`);
    return item.id;
  };
  return { workId: work.id, detail, entityId };
}

export async function publishDraftWork(
  app: E2eApp,
  workId: string,
  options: { opening?: string } = {},
): Promise<FixtureWork> {
  app.services.text.enqueue(
    proposePreviewStep({
      title: '候船厅的纸灯',
      blurb: '停电的候船厅里，一把钥匙在两个人之间停住了。',
      publicSetting: '暮色刚落，候船厅停电，主角坐在可以望见闸杆的长椅旁。',
      prose: options.opening ?? FIXTURE_OPENING,
      options: ['扳下闸杆', '留在长椅旁'],
      place: '候船厅',
      time: '暮色',
      language: 'zh-CN',
      present: ['@2', '@3'],
      changes: '',
      state: '',
    }),
  );
  const current = await app.api.works.get({ workId });
  const confirmed = await app.api.works.confirmPlan({
    workId,
    baseContentRev: current.draft.contentRev,
  });
  await app.api.works.generatePreview({
    workId,
    jobId: crypto.randomUUID(),
    contentRev: confirmed.contentRev,
  });
  const withPreview = await waitUntil(
    () => app.api.works.get({ workId }),
    (detail) => detail.latestPreviewJob?.status === 'done' || detail.latestPreviewJob?.status === 'failed',
    { label: 'preview job', timeoutMs: 40_000 },
  );
  if (withPreview.latestPreviewJob?.status !== 'done') {
    throw new Error(`preview job failed: ${withPreview.latestPreviewJob?.error ?? 'unknown'}`);
  }
  await app.api.works.adoptPreview({ workId, jobId: withPreview.latestPreviewJob.id });
  const detail = await app.api.works.get({ workId });
  return { workId, detail };
}

export async function seedAuthorPortrait(
  app: E2eApp,
  input: {
    workId: string;
    entityId: string;
    appearance: string;
    bytes: Uint8Array;
    mime?: string;
    threeQuarterBytes?: Uint8Array;
    threeQuarterMime?: string;
  },
): Promise<{ setId: string }> {
  const draft = await app.api.portrait.draft({
    workId: input.workId,
    scope: 'work',
    target: { kind: 'entity', entityId: input.entityId },
    appearance: input.appearance,
  });
  const file = new File([input.bytes], 'fixture-original-name.jpg', {
    type: input.mime ?? 'image/png',
  });
  const uploaded = await app.api.portrait.upload({
    requestId: crypto.randomUUID(),
    setId: draft.draft.id,
    slot: 'front',
    expectedRev: draft.draft.draftRev,
    file,
  });
  let latest = uploaded;
  if (input.threeQuarterBytes) {
    latest = await app.api.portrait.upload({
      requestId: crypto.randomUUID(),
      setId: uploaded.id,
      slot: 'three_quarter',
      expectedRev: uploaded.draftRev,
      file: new File([input.threeQuarterBytes], 'fixture-original-name.jpg', {
        type: input.threeQuarterMime ?? 'image/png',
      }),
    });
  }
  await app.api.portrait.adopt({
    requestId: crypto.randomUUID(),
    setId: latest.id,
    expectedRev: latest.draftRev,
    mode: 'adopt',
    expectedActiveSetId: draft.activeSetId,
  });
  return { setId: uploaded.id };
}

export async function publishFixtureWork(app: E2eApp, options: { opening?: string } = {}): Promise<FixtureWork> {
  const draft = await createDraftFixture(app);
  return publishDraftWork(app, draft.workId, options);
}

export function illustrationChoice(
  info: Awaited<ReturnType<Api['play']['getStartInfo']>>,
  overrides: Partial<StartIllustrationInput> = {},
): StartIllustrationInput {
  return {
    enabled: true,
    style: info.illustration.authorStyle,
    aspectPreference: 'auto',
    resolutionTier: '1k',
    protagonistInFrame: false,
    protagonistAppearance: null,
    protagonistSnapshotId: null,
    ...overrides,
  };
}

export async function startPlaythrough(
  app: E2eApp,
  input: { workId: string; choice?: Partial<StartIllustrationInput>; textOnly?: boolean },
): Promise<{ playthroughId: string; routeId: string }> {
  const info = await app.api.play.getStartInfo({ workId: input.workId });
  const playthroughId = crypto.randomUUID();
  const illustration = input.textOnly ? undefined : illustrationChoice(info, input.choice);
  const view = await app.api.play.start({
    workId: input.workId,
    playthroughId,
    protagonist: {},
    ...(illustration ? { illustration } : {}),
  });
  const routeId =
    view.routeId ??
    (
      await waitUntil(
        () => app.api.play.getPlaythrough({ playthroughId }),
        (playthrough) => playthrough.routeId !== null,
        { label: 'opening route', timeoutMs: 60_000 },
      )
    ).routeId;
  if (routeId === null) throw new Error('playthrough has no route');
  return { playthroughId, routeId };
}

export async function submitTurn(
  app: E2eApp,
  input: { routeId: string; text: string; prose: string; options: string[]; illustrate?: string; changes?: string },
): Promise<void> {
  const route = await app.api.play.getRoute({ routeId: input.routeId });
  app.services.text.enqueue(
    proposeTurnStep({
      prose: input.prose,
      options: input.options,
      illustrate: input.illustrate,
      changes: input.changes ?? '',
    }),
  );
  await app.api.play.submitAction({
    requestId: crypto.randomUUID(),
    routeId: input.routeId,
    expectedHeadTurnId: route.headTurnId,
    action: { text: input.text, optionIndex: null },
  });
  await waitUntil(
    () => app.api.play.getRoute({ routeId: input.routeId }),
    (next) => next.turns.length > route.turns.length && next.pending === null,
    { label: 'turn committed', timeoutMs: 60_000 },
  );
}

export function imageJobRequests(image: FakeImageServer): Array<Record<string, unknown>> {
  return image.requests
    .filter((request) => request.method === 'POST' && request.path === '/v1/jobs')
    .map((request) => request.body as Record<string, unknown>);
}

export async function openAiMultipartFiles(record: {
  body: Buffer;
}): Promise<Array<{ name: string; type: string; bytes: Buffer }>> {
  const text = record.body.toString('latin1');
  const boundary = /^--([^\r\n]+)\r\n/u.exec(text)?.[1];
  if (!boundary) return [];
  const form = await new Request('http://127.0.0.1/', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: record.body,
  }).formData();
  const files: Array<{ name: string; type: string; bytes: Buffer }> = [];
  for (const [name, value] of form.entries()) {
    if (value instanceof File) {
      files.push({ name, type: value.type, bytes: Buffer.from(await value.arrayBuffer()) });
    }
  }
  return files;
}

export interface DiagnosticSample {
  metric: string;
  outcome: string;
  request_id: string | null;
  data: string;
}

export function readSamples(dataDir: string, metric: string): DiagnosticSample[] {
  const db = new DatabaseSync(join(dataDir, 'diagnostics.db'), { readOnly: true });
  try {
    return db
      .prepare(
        'select metric, outcome, request_id, data from performance_samples where metric = ? order by created_at asc',
      )
      .all(metric) as unknown as DiagnosticSample[];
  } finally {
    db.close();
  }
}

export function diagnosticsContain(dataDir: string, value: string): boolean {
  const db = new DatabaseSync(join(dataDir, 'diagnostics.db'), { readOnly: true });
  try {
    const rows = db.prepare('select * from diagnostic_events').all() as Array<Record<string, unknown>>;
    const samples = db.prepare('select * from performance_samples').all() as Array<Record<string, unknown>>;
    return JSON.stringify([rows, samples]).includes(value);
  } finally {
    db.close();
  }
}

export function readEvents(dataDir: string, event: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(join(dataDir, 'diagnostics.db'), { readOnly: true });
  try {
    return db.prepare('select * from diagnostic_events where event = ? order by created_at asc').all(event) as Array<
      Record<string, unknown>
    >;
  } finally {
    db.close();
  }
}

export async function readProvidersFile(dataDir: string): Promise<unknown> {
  return JSON.parse(readFileSync(join(dataDir, 'providers.json'), 'utf8')) as unknown;
}

export async function readProvidersBackupBytes(dataDir: string): Promise<Buffer> {
  return readFileSync(join(dataDir, 'providers.json.bak'));
}
