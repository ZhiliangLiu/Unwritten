import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { serve } from '@hono/node-server';
import type { StartFailureReason } from '@unwritten/contracts/desktop';
import packageJson from '../package.json' with { type: 'json' };
import type { CliOptions } from './cli.ts';
import { createEventBus } from './events/bus.ts';
import { createLogger } from './log/logger.ts';
import { diagnosticFault } from './log/fault.ts';
import { createProvidersStore } from './providers/file.ts';
import { DataDirLockedError, openDatabase } from './store/db.ts';
import type { ServiceFactories, Services } from './services.ts';
import { createHttpApp } from './api/http-app.ts';
import { loadClientAssets } from './api/client-assets.ts';

export interface RunningCore {
  url: string;
  origin: string;
  port: number;
  token: string;
  services: Services;
  close(): Promise<void>;
}

export type CoreStartOptions = CliOptions & { token?: string };

type StartupFailure = StartFailureReason;

export class CoreStartupError extends Error {
  readonly reason: StartupFailure;
  readonly diagnosticId: string;

  constructor(reason: StartupFailure, diagnosticId: string, cause: unknown) {
    super(reason, { cause });
    this.reason = reason;
    this.diagnosticId = diagnosticId;
  }
}

export async function startCore(options: CoreStartOptions, factories: ServiceFactories): Promise<RunningCore> {
  const startupStarted = performance.now();
  const logger = createLogger({ dataDir: options.dataDir, level: options.logLevel, appVersion: packageJson.version });
  let opened: ReturnType<typeof openDatabase> | null = null;
  let server: ReturnType<typeof serve> | null = null;
  let waitForTasks: (() => Promise<unknown>) | undefined;
  const shutdown = new AbortController();
  const stopRuntime = async () => {
    shutdown.abort();
    const activeServer = server;
    try {
      if (activeServer) {
        const closingServer = new Promise<void>((resolve) => activeServer.close(() => resolve()));
        (activeServer as { closeAllConnections?: () => void }).closeAllConnections?.();
        await closingServer;
      }
      await waitForTasks?.();
    } finally {
      opened?.close();
    }
  };

  let stage = 'data_dir';
  let stageStarted = startupStarted;
  try {
    mkdirSync(options.dataDir, { recursive: true });
    stage = 'library_open';
    const libraryStarted = (stageStarted = performance.now());
    try {
      opened = openDatabase(join(options.dataDir, 'library.db'));
    } catch (error) {
      if (error instanceof DataDirLockedError) {
        logger.record({ level: 'error', module: 'core', event: 'store.locked' });
      }
      throw error;
    }
    logger.sample({
      metric: 'core.library_open',
      durationMs: performance.now() - libraryStarted,
      outcome: 'ok',
    });
    logger.record({ level: 'info', module: 'core', event: 'store.migrated' });
    logger.record({ level: 'info', module: 'core', event: 'story.backfill', data: { ...opened.backfill } });

    stage = 'services';
    const bus = createEventBus();
    const providers = createProvidersStore(join(options.dataDir, 'providers.json'), {
      onMigrated: (backup) =>
        logger.record({
          level: 'info',
          module: 'providers',
          event: 'providers.migrated',
          data: { from: 1, to: 2, backup },
        }),
    });
    const deps = {
      shutdown: shutdown.signal,
      dataDir: options.dataDir,
      db: opened.db,
      bus,
      logger,
      providers,
    };
    const llm = factories.llm(deps);
    const settings = factories.settings(deps);
    const summary = factories.summary({ ...deps, llm });
    const authoring = factories.authoring({ ...deps, llm });
    const image = factories.image({ ...deps, llm });
    const illustration = factories.illustration({ ...deps, llm, image });
    const cleanupTasks = new Set<Promise<void>>();
    const recordGcFailure = (trigger: 'startup' | 'work_deleted', error: unknown): void => {
      logger.record({
        level: 'warn',
        module: 'illustration',
        event: 'image.gc.failed',
        data: { trigger, code: diagnosticFault(error).systemCode ?? 'internal' },
      });
    };
    const library = factories.library({
      ...deps,
      onWorkDeleted: () => {
        const task = illustration
          .collectGarbage()
          .catch((error: unknown) => recordGcFailure('work_deleted', error))
          .finally(() => {
            cleanupTasks.delete(task);
          });
        cleanupTasks.add(task);
      },
    });
    const play = factories.play({
      ...deps,
      llm,
      summary,
      image,
      illustration,
      onIllustrationQueued: () => illustration.kick(),
    });
    const services: Services = {
      llm,
      image,
      illustration,
      library,
      authoring,
      play,
      settings,
      summary,
      bus,
      logger,
    };
    waitForTasks = () =>
      Promise.all([
        authoring.whenIdle(),
        play.whenIdle(),
        summary.whenIdle(),
        image.whenIdle(),
        illustration.whenIdle(),
        Promise.all(cleanupTasks),
      ]);

    stage = 'recovery';
    const recoverStarted = (stageStarted = performance.now());
    const turnRequests = play.recoverInterrupted();
    const jobs = authoring.recoverInterrupted();
    const summaries = summary.backfill();
    const illustrations = illustration.recoverInterrupted();
    image.pruneCalls();
    llm.pruneCalls();
    play.pruneOldRequestLogs();
    logger.sample({ metric: 'core.recover', durationMs: performance.now() - recoverStarted, outcome: 'ok' });
    logger.record({
      level: 'info',
      module: 'core',
      event: 'recovery.interrupted',
      data: { turnRequests, jobs, summaries, illustrations },
    });
    try {
      await illustration.prepareStorage();
    } catch (error) {
      recordGcFailure('startup', error);
    }

    stage = 'client_assets';
    const token = options.token ?? randomBytes(32).toString('base64url');
    const assets = loadClientAssets(options.clientDir);
    if (!assets) logger.record({ level: 'warn', module: 'core', event: 'client.assets.missing' });

    let port = 0;
    const app = createHttpApp({ token, getPort: () => port, assets, services, logger });
    stage = 'http_listen';
    port = await new Promise<number>((resolve, reject) => {
      const listening = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: options.port }, (info) => {
        listening.off('error', reject);
        resolve(info.port);
      });
      listening.once('error', reject);
      server = listening;
    });
    const origin = `http://127.0.0.1:${port}`;
    const url = `${options.clientOrigin ?? origin}/#token=${token}`;
    logger.record({ level: 'info', module: 'core', event: 'core.started', data: { port } });
    logger.sample({ metric: 'core.startup', durationMs: performance.now() - startupStarted, outcome: 'ok' });
    illustration.kick();

    let closing: Promise<void> | null = null;
    return {
      url,
      origin,
      port,
      token,
      services,
      close() {
        if (closing) return closing;
        closing = (async () => {
          try {
            await stopRuntime();
            logger.record({ level: 'info', module: 'core', event: 'core.stopped' });
          } finally {
            await logger.close();
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    const fault = diagnosticFault(error);
    const reason =
      error instanceof DataDirLockedError
        ? 'data_locked'
        : fault.systemCode === 'EADDRINUSE'
          ? 'port_in_use'
          : stage === 'data_dir'
            ? 'data_dir'
            : 'startup';
    const diagnosticId = randomUUID();
    logger.record({
      id: diagnosticId,
      level: 'error',
      module: 'core',
      event: 'core.start_failed',
      data: { stage, reason, ...fault },
    });
    const now = performance.now();
    logger.sample({ metric: 'core.startup', durationMs: now - startupStarted, outcome: 'error' });
    if (stage === 'library_open' || stage === 'recovery') {
      logger.sample({
        metric: stage === 'library_open' ? 'core.library_open' : 'core.recover',
        durationMs: now - stageStarted,
        outcome: 'error',
      });
    }
    try {
      await stopRuntime();
    } catch (cleanupError) {
      logger.record({
        level: 'error',
        module: 'core',
        event: 'core.start_cleanup_failed',
        data: { ...diagnosticFault(cleanupError) },
      });
    } finally {
      await logger.close();
    }
    throw new CoreStartupError(reason, diagnosticId, error);
  }
}
