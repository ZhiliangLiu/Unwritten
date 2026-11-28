import { readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { RPCHandler } from '@orpc/server/fetch';
import { NOVEL_IMPORT_MAX_BODY_BYTES, PORTRAIT_UPLOAD_MAX_BODY_BYTES } from '@unwritten/contracts';
import type { Services } from '../services.ts';
import type { Logger } from '../log/logger.ts';
import type { ClientAssets } from './client-assets.ts';
import { contentSecurityPolicy, newNonce, renderIndexHtml } from './client-assets.ts';
import { createRouter } from './router.ts';
import { rpcError } from './rpc-error.ts';
import { diagnosticFault } from '../log/fault.ts';
import { hostGuard, originGuard, tokenGuard } from './security.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.json': 'application/json',
  '.map': 'application/json',
};

export interface HttpAppOptions {
  token: string;
  getPort(): number;
  assets: ClientAssets | null;
  services: Services;
  logger: Logger;
}

export function createHttpApp(options: HttpAppOptions): Hono {
  const app = new Hono();
  const rpcHandler = new RPCHandler(createRouter(options.services), {
    interceptors: [
      async (interceptor) => {
        try {
          return await interceptor.next();
        } catch (error) {
          throw rpcError(options.logger, error);
        }
      },
    ],
  });

  app.onError((error, c) => {
    options.logger.record({
      level: 'error',
      module: 'api',
      event: 'http.failed',
      data: { stage: 'response', ...diagnosticFault(error) },
    });
    return c.text('internal error', 500);
  });

  app.use(
    '*',
    hostGuard(() => options.getPort(), options.logger),
  );
  app.use('*', originGuard(options.logger));
  app.use('/api/*', tokenGuard(options.token, options.logger));

  app.post(
    '/api/portrait/upload',
    bodyLimit({
      maxSize: PORTRAIT_UPLOAD_MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'payload_too_large' }, 413),
    }),
  );

  app.post(
    '/api/works/importNovel',
    bodyLimit({
      maxSize: NOVEL_IMPORT_MAX_BODY_BYTES,
      onError: (c) => c.json({ defined: false, code: 'novel_too_large', status: 413, message: 'novel_too_large' }, 413),
    }),
  );

  app.use('/api/image/file', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
  });

  app.all('/api/*', async (c) => {
    const { matched, response } = await rpcHandler.handle(c.req.raw, {
      prefix: '/api',
      context: { services: options.services },
    });
    return matched ? response : c.notFound();
  });

  app.get('/assets/*', (c) => {
    if (!options.assets) return c.notFound();
    const relative = c.req.path.replace(/^\//, '');
    const resolved = resolve(options.assets.dir, relative);
    const root = join(options.assets.dir, 'assets') + sep;
    if (!resolved.startsWith(root)) return c.notFound();
    try {
      if (!statSync(resolved).isFile()) return c.notFound();
      const data = readFileSync(resolved);
      const extension = resolved.slice(resolved.lastIndexOf('.'));
      c.header('Content-Type', CONTENT_TYPES[extension] ?? 'application/octet-stream');
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
      c.header('X-Content-Type-Options', 'nosniff');
      return c.body(data);
    } catch (error) {
      const fault = diagnosticFault(error);
      if (fault.systemCode === 'ENOENT' || fault.systemCode === 'ENOTDIR') return c.notFound();
      options.logger.record({
        level: 'error',
        module: 'api',
        event: 'http.failed',
        data: { stage: 'asset_read', ...fault },
      });
      return c.text('internal error', 500);
    }
  });

  app.get('*', (c) => {
    if (!options.assets) return c.text('client build not found', 503);
    const nonce = newNonce();
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('Cache-Control', 'no-store');
    c.header('Content-Security-Policy', contentSecurityPolicy(nonce));
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    return c.html(renderIndexHtml(options.assets, nonce, options.services.settings.get()));
  });

  return app;
}
