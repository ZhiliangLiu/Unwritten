import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { serve } from '@hono/node-server';
import packageJson from '../package.json' with { type: 'json' };
import type { CliOptions } from './cli.ts';
import { createEventBus } from './events/bus.ts';
import { createLogger } from './log/logger.ts';
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

export async function startCore(options: CliOptions, factories: ServiceFactories): Promise<RunningCore> {
  mkdirSync(options.dataDir, { recursive: true });
  const startupStarted = performance.now();
  const logger = createLogger({ dataDir: options.dataDir, level: options.logLevel, appVersion: packageJson.version });
  let opened: ReturnType<typeof openDatabase> | null = null;
  let server: ReturnType<typeof serve> | null = null;

  try {
    const libraryStarted = performance.now();
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

    const shutdown = new AbortController();
    const bus = createEventBus();
    const deps = {
      shutdown: shutdown.signal,
      dataDir: options.dataDir,
      db: opened.db,
      bus,
      logger,
    };
    const llm = factories.llm(deps);
    const library = factories.library(deps);
    const settings = factories.settings(deps);
    const summary = factories.summary({ ...deps, llm });
    const authoring = factories.authoring({ ...deps, llm });
    const play = factories.play({ ...deps, llm, summary });
    const services: Services = { llm, library, authoring, play, settings, summary, bus, logger };

    const recoverStarted = performance.now();
    const turnRequests = play.recoverInterrupted();
    const jobs = authoring.recoverInterrupted();
    const summaries = summary.backfill();
    llm.pruneCalls();
    play.pruneOldRequestLogs();
    logger.sample({ metric: 'core.recover', durationMs: performance.now() - recoverStarted, outcome: 'ok' });
    logger.record({
      level: 'info',
      module: 'core',
      event: 'recovery.interrupted',
      data: { turnRequests, jobs, summaries },
    });

    const token = randomBytes(32).toString('base64url');
    const assets = loadClientAssets(options.clientDir);
    if (!assets) logger.record({ level: 'warn', module: 'core', event: 'client.assets.missing' });

    let port = 0;
    const app = createHttpApp({ token, getPort: () => port, assets, services, logger });
    port = await new Promise<number>((resolve, reject) => {
      try {
        server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: options.port }, (info) => resolve(info.port));
      } catch (error) {
        reject(error);
      }
    });
    const origin = `http://127.0.0.1:${port}`;
    const url = `${options.clientOrigin ?? origin}/#token=${token}`;
    logger.record({ level: 'info', module: 'core', event: 'core.started', data: { port } });
    logger.sample({ metric: 'core.startup', durationMs: performance.now() - startupStarted, outcome: 'ok' });

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
          shutdown.abort();
          if (server) {
            const closingServer = new Promise<void>((resolve) => server!.close(() => resolve()));
            (server as { closeAllConnections?: () => void }).closeAllConnections?.();
            await closingServer;
          }
          await Promise.all([authoring.whenIdle(), play.whenIdle(), summary.whenIdle()]);
          opened?.close();
          logger.record({ level: 'info', module: 'core', event: 'core.stopped' });
          await logger.close();
        })();
        return closing;
      },
    };
  } catch (error) {
    logger.record({ level: 'error', module: 'core', event: 'core.start_failed', data: { stage: 'startup' } });
    opened?.close();
    await logger.close();
    throw error;
  }
}
